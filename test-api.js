const fs = require('fs');
const axios = require('axios');

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
        port: 33335,
        auth: {
            username: 'brd-customer-hl_488f646c-zone-isp_proxy1',
            password: '4nqz088zgsve',
        }
    }
];

// Тестовые ID
// const testIds = [18339587, 30301487, 30027560, 30023560];
const testIds = [30301487 ];

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
    const url = `https://kaspi.kz/yml/review-view/api/v1/reviews/merchant/${merchantId}?limit=10&page=0&filter=COMMENT&sort=DATE&withAgg=true&days=90`;
    const userAgent = getRandomUserAgent();

    console.log(`🔍 Попытка ${attempt}: Отправляем запрос на ${url}`);
    console.log(`📱 User-Agent: ${userAgent}`);
    console.log(`🌐 Прокси: ${proxyConfig ? `${proxyConfig.host}:${proxyConfig.port}` : 'direct'}`);

    const config = {
        method: 'GET',
        url: url,
        headers: {
            'User-Agent': userAgent,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
            'Connection': 'keep-alive',
            'Host': 'kaspi.kz',
            'Referer': `https://kaspi.kz/shop/info/merchant/${merchantId}/review/`,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Site': 'same-origin',
            'Cookie': 'ks.tg=78; k_stat=434ef73d-3017-4d35-be18-fdf5e4772d31'
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

        console.log(`📊 Статус ответа: ${response.status}`);
        console.log(`📋 Заголовки ответа:`, JSON.stringify(response.headers, null, 2));
        
        // Показываем полный ответ от сервера
        console.log('📄 ПОЛНЫЙ ОТВЕТ ОТ СЕРВЕРА:');
        console.log('─'.repeat(50));
        if (typeof response.data === 'object') {
            console.log(JSON.stringify(response.data, null, 2));
        } else {
            console.log(response.data);
        }
        console.log('─'.repeat(50));

        // Если получили 429 (Too Many Requests) и есть попытки
        if (response.status === 429 && attempt < maxAttempts) {
            console.log(`⚠️ 429 ошибка для ID ${merchantId}, попытка ${attempt}/${maxAttempts}. Повтор через 2 секунды...`);
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            return makeRequest(merchantId, proxyConfig, attempt + 1, maxAttempts);
        }

        return {
            statusCode: response.status,
            merchantId: merchantId,
            success: response.status === 200,
            proxy: proxyConfig ? `${proxyConfig.host}:${proxyConfig.port}` : 'direct',
            attempt: attempt,
            data: response.data
        };

    } catch (error) {
        console.error(`❌ Ошибка запроса:`, error.message);

        // При ошибке сети тоже можем повторить
        if (attempt < maxAttempts && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND')) {
            console.log(`⚠️ Ошибка сети для ID ${merchantId}, попытка ${attempt}/${maxAttempts}. Повтор через 1 секунду...`);
            
            await new Promise(resolve => setTimeout(resolve, 1000));
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

// Главная функция тестирования
(async () => {
    console.log('🚀 Запуск тестового API запроса...');
    console.log(`🎯 Тестируем ${testIds.length} ID: ${testIds.join(', ')}`);
    console.log('═'.repeat(60));

    for (let i = 0; i < testIds.length; i++) {
        const testId = testIds[i];
        const proxyConfig = getRandomProxy();

        console.log(`\n🔢 ТЕСТ ${i + 1}/${testIds.length} - ID: ${testId}`);
        console.log('─'.repeat(50));

        try {
            const result = await makeRequest(testId, proxyConfig);

            console.log('─'.repeat(50));
            console.log('📊 РЕЗУЛЬТАТ ТЕСТА:');
            console.log(`ID: ${result.merchantId}`);
            console.log(`Статус: ${result.statusCode}`);
            console.log(`Успешно: ${result.success ? '✅' : '❌'}`);
            console.log(`Прокси: ${result.proxy}`);
            console.log(`Попыток: ${result.attempt}`);
            
            if (result.error) {
                console.log(`Ошибка: ${result.error}`);
            }

            if (result.data) {
                console.log('─'.repeat(30));
                console.log('📄 ПОЛНЫЙ ОТВЕТ:');
                console.log(result.data);
            }

        } catch (error) {
            console.error(`❌ Критическая ошибка для ID ${testId}:`, error.message);
        }

        // Пауза между тестами
        if (i < testIds.length - 1) {
            console.log('\n⏳ Пауза 2 секунды перед следующим тестом...');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    console.log('\n═'.repeat(60));
    console.log('✅ Все тесты завершены');
})();
