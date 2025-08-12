const fs = require('fs');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Настройки Supabase
const supabaseUrl = 'https://xnwacziuktpvayhoozlr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhud2Fjeml1a3RwdmF5aG9vemxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxNjUyODgsImV4cCI6MjA2Nzc0MTI4OH0.EJUJg4m3KD8f1KT8Hsz6uXB2PxdpftkhDdfzwYp6vzw';
const supabase = createClient(supabaseUrl, supabaseKey);

// Настройки
const OUTPUT_FILE = 'valid_merchant_ids.txt';
const ID_LOG_FILE = 'processed_api_ids.txt';
const ID_LOG_BACKUP = 'processed_api_ids_backup.txt';
const TOTAL_REQUESTS = 10000000000;
const CONCURRENT_REQUESTS = 50;
const MIN_ID_LENGTH = 4;
const MAX_ID_LENGTH = 7;
const MAX_SET_SIZE = 100000;
const CLEANUP_INTERVAL = 100000;
const FILE_SIZE_LIMIT = 100 * 1024 * 1024; // 100MB лимит для файла

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

// Переменные для отслеживания
let processedIds = new Set();
let totalProcessedCount = 0;

// Функция для ротации файла логов
function rotateLogFile() {
    try {
        if (fs.existsSync(ID_LOG_FILE)) {
            const stats = fs.statSync(ID_LOG_FILE);
            
            if (stats.size > FILE_SIZE_LIMIT) {
                console.log(`📁 Файл лога достиг ${Math.round(stats.size / 1024 / 1024)}MB, выполняем ротацию...`);
                
                // Создаем бэкап старого файла
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupName = `processed_api_ids_${timestamp}.txt`;
                fs.renameSync(ID_LOG_FILE, backupName);
                
                console.log(`📁 Старый лог сохранен как: ${backupName}`);
                
                // Очищаем Set так как начинаем новый файл
                processedIds.clear();
                totalProcessedCount = 0;
                
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error('❌ Ошибка ротации файла:', error.message);
        return false;
    }
}

// Функция для чтения только последней части файла
function loadRecentProcessedIds() {
    try {
        // Сначала проверяем нужна ли ротация
        rotateLogFile();
        
        if (fs.existsSync(ID_LOG_FILE)) {
            const stats = fs.statSync(ID_LOG_FILE);
            console.log(`📋 Размер файла логов: ${Math.round(stats.size / 1024 / 1024)}MB`);
            
            // Если файл слишком большой, читаем только последнюю часть
            if (stats.size > 50 * 1024 * 1024) { // Если больше 50MB
                console.log(`📋 Файл большой, читаем только последние записи...`);
                
                const fd = fs.openSync(ID_LOG_FILE, 'r');
                const bufferSize = 10 * 1024 * 1024; // Читаем последние 10MB
                const buffer = Buffer.alloc(bufferSize);
                const position = Math.max(0, stats.size - bufferSize);
                
                fs.readSync(fd, buffer, 0, bufferSize, position);
                fs.closeSync(fd);
                
                const data = buffer.toString('utf-8');
                const lines = data.split('\n').filter(line => line.trim());
                
                // Берем только последние записи
                const recentLines = lines.slice(-MAX_SET_SIZE);
                processedIds = new Set(recentLines);
                totalProcessedCount = lines.length; // Приблизительное количество
                
                console.log(`📋 Загружено последних ${processedIds.size} ID из файла`);
            } else {
                // Файл небольшой, читаем полностью
                const data = fs.readFileSync(ID_LOG_FILE, 'utf-8');
                const lines = data.split('\n').filter(line => line.trim());
                totalProcessedCount = lines.length;
                
                const recentLines = lines.slice(-MAX_SET_SIZE);
                processedIds = new Set(recentLines);
                
                console.log(`📋 Всего обработано: ${totalProcessedCount}, в памяти: ${processedIds.size} ID`);
            }
        } else {
            console.log(`📋 Файл логов не найден, начинаем с нуля`);
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки логов:', error.message);
        console.log('📋 Начинаем с чистого листа');
        processedIds = new Set();
        totalProcessedCount = 0;
    }
}

loadRecentProcessedIds();

// Функция для очистки памяти
function cleanupProcessedIds() {
    if (processedIds.size >= MAX_SET_SIZE) {
        console.log(`🧹 Очистка памяти: Set достиг ${processedIds.size} элементов`);
        
        // Оставляем только половину самых новых записей
        const idsArray = Array.from(processedIds);
        const keepCount = Math.floor(MAX_SET_SIZE / 2);
        processedIds = new Set(idsArray.slice(-keepCount));
        
        // Принудительная сборка мусора если доступна
        if (global.gc) {
            global.gc();
        }
    }
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

// Функция для проверки обработанного ID
function isIdProcessed(merchantId) {
    return processedIds.has(merchantId.toString());
}

// Функция для выполнения HTTP запроса
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
            return status < 500;
        }
    };

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

        if (response.status === 429 && attempt < maxAttempts) {
            console.log(`⚠️ 429 ошибка для ID ${merchantId}, попытка ${attempt}/${maxAttempts}. Повтор через 100мс...`);
            await new Promise(resolve => setTimeout(resolve, 100));
            return makeRequest(merchantId, proxyConfig, attempt + 1, maxAttempts);
        }

        const hasData = response.status === 200 && 
                       response.data && 
                       response.data.data && 
                       Array.isArray(response.data.data) && 
                       response.data.data.length > 0;

        return {
            statusCode: response.status,
            merchantId: merchantId,
            success: response.status === 200,
            hasData: hasData,
            dataLength: response.data?.data?.length || 0,
            proxy: proxyConfig ? `${proxyConfig.host}:${proxyConfig.port}` : 'direct',
            attempt: attempt
        };

    } catch (error) {
        if (attempt < maxAttempts && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND')) {
            console.log(`⚠️ Ошибка сети для ID ${merchantId}, попытка ${attempt}/${maxAttempts}. Повтор через 200мс...`);
            await new Promise(resolve => setTimeout(resolve, 200));
            return makeRequest(merchantId, proxyConfig, attempt + 1, maxAttempts);
        }

        return {
            statusCode: 0,
            merchantId: merchantId,
            success: false,
            hasData: false,
            dataLength: 0,
            error: error.message,
            proxy: proxyConfig ? `${proxyConfig.host}:${proxyConfig.port}` : 'direct',
            attempt: attempt
        };
    }
}

// Функция для записи валидного ID в Supabase
async function saveValidIdToSupabase(merchantId, dataLength) {
    try {
        const record = {
            merchant_id: parseInt(merchantId),
            data_length: dataLength,
            found_at: new Date().toISOString()
        };

        const { error } = await supabase
            .from('generateid_valid')
            .insert([record]);

        if (error) {
            console.error(`❌ Ошибка записи ID ${merchantId} в Supabase:`, error.message);
            fs.appendFileSync(OUTPUT_FILE, `${merchantId}\n`);
            return false;
        } else {
            console.log(`💾 ID ${merchantId} сохранен в Supabase (${dataLength} отзывов)`);
            return true;
        }

    } catch (error) {
        console.error(`❌ Критическая ошибка записи ID ${merchantId}:`, error.message);
        fs.appendFileSync(OUTPUT_FILE, `${merchantId}\n`);
        return false;
    }
}

// Функция для записи обработанного ID
function logProcessedId(merchantId) {
    // Проверяем нужна ли ротация файла перед записью
    rotateLogFile();
    
    fs.appendFileSync(ID_LOG_FILE, `${merchantId}\n`);
    processedIds.add(merchantId.toString());
    totalProcessedCount++;
    
    // Периодическая очистка памяти
    if (totalProcessedCount % CLEANUP_INTERVAL === 0) {
        cleanupProcessedIds();
    }
}

// Основная функция обработки
async function processId() {
    let merchantId;
    let attempts = 0;
    const maxAttempts = 100;
    
    do {
        merchantId = getRandomId();
        attempts++;
        
        if (attempts >= maxAttempts) {
            break;
        }
    } while (isIdProcessed(merchantId));

    const proxyConfig = getRandomProxy();

    try {
        const result = await makeRequest(merchantId, proxyConfig);

        if (result.hasData) {
            await saveValidIdToSupabase(merchantId, result.dataLength);
            console.log(`✅ ID ${merchantId}: найдено ${result.dataLength} отзывов, сохранено в базу`);
        } else if (result.success) {
            // console.log(`ℹ️ ID ${merchantId}: ответ 200, но данных нет (${result.dataLength} отзывов)`);
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
            hasData: false,
            dataLength: 0,
            error: error.message
        };
    }
}

// Главная функция
(async () => {
    console.log('🚀 Запуск API парсера...');
    console.log(`📊 Настройки: ${CONCURRENT_REQUESTS} одновременных запросов, максимум ${TOTAL_REQUESTS} попыток`);
    console.log(`🧠 Память: максимум ${MAX_SET_SIZE} ID в памяти, очистка каждые ${CLEANUP_INTERVAL} записей`);

    let completedRequests = 0;
    let foundValidIds = 0;
    let emptyResponses = 0;
    let errors = 0;

    // Функция для обработки одного запроса
    async function processRequest() {
        if (completedRequests >= TOTAL_REQUESTS) return;

        const result = await processId();
        completedRequests++;

        if (result.hasData) {
            foundValidIds++;
        } else if (result.success) {
            emptyResponses++;
        } else {
            errors++;
        }

        // Статистика каждые 100 запросов
        if (completedRequests % 100 === 0) {
            console.log(`📈 Прогресс: ${completedRequests}/${TOTAL_REQUESTS} | С данными: ${foundValidIds} | Пустые: ${emptyResponses} | Ошибок: ${errors} | В памяти: ${processedIds.size} ID`);
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
    console.log(`   С данными (сохранено): ${foundValidIds}`);
    console.log(`   Пустые ответы (200, но без данных): ${emptyResponses}`);
    console.log(`   Ошибок: ${errors}`);
    console.log(`   Валидные ID сохранены в: ${OUTPUT_FILE}`);
})();
