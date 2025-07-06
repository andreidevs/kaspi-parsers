const fs = require('fs');
const axios = require('axios');

// Настройки
const OUTPUT_FILE = 'valid_merchant_ids.txt';
const ID_LOG_FILE = 'processed_api_ids.txt';
const TOTAL_REQUESTS = 10000000000;
const CONCURRENT_REQUESTS = 50;
const MIN_ID_LENGTH = 7;
const MAX_ID_LENGTH = 8;

// Массив User-Agent
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/119.0'
];

// Конфигурация прокси
const proxyConfigs = [
    {
        protocol: 'http',
        host: 'brd.superproxy.io',
        port: 22225,
        auth: {
            username: 'brd-customer-hl_488f646c-zone-isp_proxy1',
            password: '4nqz088zgsve',
        }
    }
];

console.log(`📡 Загружено ${proxyConfigs.length} прокси конфигураций`);

// Чтение уже обработанных ID
let processedIds = new Set();
if (fs.existsSync(ID_LOG_FILE)) {
    const data = fs.readFileSync(ID_LOG_FILE, 'utf-8');
    data.split('\n').forEach(id => {
        if (id.trim()) processedIds.add(id.trim());
    });
    console.log(`📋 Загружено ${processedIds.size} уже обработанных ID`);
}

// Функция для генерации случайного ID
function getRandomId(minLength = MIN_ID_LENGTH, maxLength = MAX_ID_LENGTH) {
    const min = Math.pow(10, minLength - 1);
    const max = Math.pow(10, maxLength) - 1;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Функция для получения случайного User-Agent
function getRandomUserAgent() {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Функция для получения случайного прокси
function getRandomProxy() {
    if (proxyConfigs.length === 0) return null;
    return proxyConfigs[Math.floor(Math.random() * proxyConfigs.length)];
}

// Функция для выполнения HTTP запроса с повторными попытками
async function makeRequest(merchantId, proxyConfig = null, attempt = 1, maxAttempts = 3) {
    const url = `https://kaspi.kz/yml/review-view/api/v1/reviews/merchant/${merchantId}`;
    const userAgent = getRandomUserAgent();

    const config = {
        method: 'GET',
        url: url,
        headers: {
            'User-Agent': userAgent,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Host': 'kaspi.kz',
            'Referer': `https://kaspi.kz/shop/info/merchant/${merchantId}/review/`,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
        },
        timeout: 10000,
        validateStatus: function (status) {
            return status < 500; // Не выбрасывать ошибку для статусов < 500
        }
    };

    // Добавляем прокси если есть
    if (proxyConfig) {
        config.proxy = {
            protocol: proxyConfig.protocol,
            host: proxyConfig.host,
            port: proxyConfig.port,
            auth: {
                username: proxyConfig.auth.username,
                password: proxyConfig.auth.password
            }
        };
    }

    try {
        const response = await axios(config);

        // Если получили 429 (Too Many Requests) и есть попытки
        if (response.status === 429 && attempt < maxAttempts) {
            console.log(`⚠️ 429 ошибка для ID ${merchantId}, попытка ${attempt}/${maxAttempts}. Повтор через 100мс...`);
            
            await new Promise(resolve => setTimeout(resolve, 100));
            return makeRequest(merchantId, proxyConfig, attempt + 1, maxAttempts);
        }

        return {
            statusCode: response.status,
            merchantId: merchantId,
            success: response.status === 200,
            proxy: proxyConfig ? `${proxyConfig.host}:${proxyConfig.port}` : 'direct',
            attempt: attempt
        };

    } catch (error) {
        // При ошибке сети тоже можем повторить
        if (attempt < maxAttempts && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND')) {
            console.log(`⚠️ Ошибка сети для ID ${merchantId}, попытка ${attempt}/${maxAttempts}. Повтор через 200мс...`);
            
            await new Promise(resolve => setTimeout(resolve, 200));
            return makeRequest(merchantId, proxyConfig, attempt + 1, maxAttempts);
        }

        return {
            statusCode: 0,
            merchantId: merchantId,
            success: false,
            error: error.message,
            proxy: proxyConfig ? `${proxyConfig.host}:${proxyConfig.port}` : 'direct',
            attempt: attempt
        };
    }
}

// Функция для записи валидного ID
function saveValidId(merchantId) {
    fs.appendFileSync(OUTPUT_FILE, `${merchantId}\n`);
    console.log(`✅ Найден валидный ID: ${merchantId}`);
}

// Функция для записи обработанного ID
function logProcessedId(merchantId) {
    fs.appendFileSync(ID_LOG_FILE, `${merchantId}\n`);
    processedIds.add(merchantId.toString());
}

// Основная функция обработки
async function processId() {
    let merchantId;
    do {
        merchantId = getRandomId();
    } while (processedIds.has(merchantId.toString()));

    const proxyConfig = getRandomProxy();

    try {
        const result = await makeRequest(merchantId, proxyConfig);

        if (result.success) {
            saveValidId(merchantId);
        }

        logProcessedId(merchantId);
        return result;

    } catch (error) {
        console.error(`❌ Ошибка при обработке ID ${merchantId}:`, error.message);
        logProcessedId(merchantId);
        return {
            statusCode: 0,
            merchantId: merchantId,
            success: false,
            error: error.message
        };
    }
}

// Главная функция
(async () => {
    console.log('🚀 Запуск API парсера...');
    console.log(`📊 Настройки: ${CONCURRENT_REQUESTS} одновременных запросов, максимум ${TOTAL_REQUESTS} попыток`);

    let completedRequests = 0;
    let foundValidIds = 0;
    let errors = 0;

    // Функция для обработки одного запроса
    async function processRequest() {
        if (completedRequests >= TOTAL_REQUESTS) return;

        const result = await processId();
        completedRequests++;

        if (result.success) {
            foundValidIds++;
        } else {
            errors++;
        }

        // Статистика каждые 100 запросов
        if (completedRequests % 100 === 0) {
            console.log(`📈 Прогресс: ${completedRequests}/${TOTAL_REQUESTS} | Найдено: ${foundValidIds} | Ошибок: ${errors}`);
        }
    }

    // Запуск параллельных процессов
    const promises = [];
    for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
        promises.push((async () => {
            while (completedRequests < TOTAL_REQUESTS) {
                await processRequest();
                // Небольшая пауза между запросами
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        })());
    }

    await Promise.all(promises);

    console.log('✅ Парсинг завершён!');
    console.log(`📊 Итоговая статистика:`);
    console.log(`   Всего запросов: ${completedRequests}`);
    console.log(`   Найдено валидных ID: ${foundValidIds}`);
    console.log(`   Ошибок: ${errors}`);
    console.log(`   Валидные ID сохранены в: ${OUTPUT_FILE}`);
})();
