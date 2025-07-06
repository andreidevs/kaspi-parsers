const fs = require('fs');
const https = require('https');
const http = require('http');
const {HttpsProxyAgent} = require('https-proxy-agent');
const {HttpProxyAgent} = require('http-proxy-agent');

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
const testIds = [18339587, 30301487, 30027560, 30023560];

// Функция для получения случайного User-Agent
function getRandomUserAgent() {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Функция для получения случайного прокси
function getRandomProxy() {
    if (proxyConfigs.length === 0) return null;
    return proxyConfigs[Math.floor(Math.random() * proxyConfigs.length)];
}

// Функция для создания агента прокси
function createProxyAgent(proxyConfig) {
    if (!proxyConfig) return null;

    const {protocol, host, port, auth} = proxyConfig;

    let proxyUrl;
    if (auth && auth.username && auth.password) {
        proxyUrl = `${protocol}://${auth.username}:${auth.password}@${host}:${port}`;
    } else {
        proxyUrl = `${protocol}://${host}:${port}`;
    }

    return protocol === 'https' ? new HttpsProxyAgent(proxyUrl) : new HttpProxyAgent(proxyUrl);
}

// Функция для выполнения HTTP запроса с повторными попытками
function makeRequest(merchantId, proxyConfig = null, attempt = 1, maxAttempts = 3) {
    return new Promise((resolve) => {
        const url = `https://kaspi.kz/yml/review-view/api/v1/reviews/merchant/${merchantId}?limit=10&page=0&filter=COMMENT&sort=DATE&withAgg=true&days=90`;
        const userAgent = getRandomUserAgent();

        console.log(`🔍 Попытка ${attempt}: Отправляем запрос на ${url}`);
        console.log(`📱 User-Agent: ${userAgent}`);
        console.log(`🌐 Прокси: ${proxyConfig ? `${proxyConfig.host}:${proxyConfig.port}` : 'direct'}`);

        const options = {
            method: 'GET',
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
            timeout: 10000
        };

        // Добавляем прокси если есть
        // if (proxyConfig) {
        //     const agent = createProxyAgent(proxyConfig);
        //     if (agent) {
        //         options.agent = agent;
        //     }
        // }

        const req = https.request(url, options, (res) => {
            let data = '';

            console.log(`📊 Статус ответа: ${res.statusCode}`);
            console.log(`📋 Заголовки ответа:`, res.headers);

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log(`📄 Тело ответа (первые 500 символов):`, data.substring(0, 500));

                // Если получили 429 (Too Many Requests) и есть попытки
                if (res.statusCode === 429 && attempt < maxAttempts) {
                    console.log(`⚠️ 429 ошибка для ID ${merchantId}, попытка ${attempt}/${maxAttempts}. Повтор через 2 секунды...`);

                    setTimeout(() => {
                        makeRequest(merchantId, proxyConfig, attempt + 1, maxAttempts)
                            .then(resolve)
                            .catch(resolve);
                    }, 2000);

                    return;
                }

                resolve({
                    statusCode: res.statusCode,
                    merchantId: merchantId,
                    success: res.statusCode === 200,
                    proxy: proxyConfig ? `${proxyConfig.host}:${proxyConfig.port}` : 'direct',
                    attempt: attempt,
                    data: data
                });
            });
        });

        req.on('error', (error) => {
            console.error(`❌ Ошибка запроса:`, error.message);

            // При ошибке сети тоже можем повторить
            if (attempt < maxAttempts) {
                console.log(`⚠️ Ошибка сети для ID ${merchantId}, попытка ${attempt}/${maxAttempts}. Повтор через 1 секунду...`);

                setTimeout(() => {
                    makeRequest(merchantId, proxyConfig, attempt + 1, maxAttempts)
                        .then(resolve)
                        .catch(resolve);
                }, 1000);

                return;
            }

            resolve({
                statusCode: 0,
                merchantId: merchantId,
                success: false,
                error: error.message,
                proxy: proxyConfig ? `${proxyConfig.host}:${proxyConfig.port}` : 'direct',
                attempt: attempt
            });
        });

        req.on('timeout', () => {
            req.destroy();
            console.log(`⏰ Таймаут запроса`);

            // При таймауте тоже можем повторить
            if (attempt < maxAttempts) {
                console.log(`⚠️ Таймаут для ID ${merchantId}, попытка ${attempt}/${maxAttempts}. Повтор через 1 секунду...`);

                setTimeout(() => {
                    makeRequest(merchantId, proxyConfig, attempt + 1, maxAttempts)
                        .then(resolve)
                        .catch(resolve);
                }, 1000);

                return;
            }

            resolve({
                statusCode: 0,
                merchantId: merchantId,
                success: false,
                error: 'Timeout',
                proxy: proxyConfig ? `${proxyConfig.host}:${proxyConfig.port}` : 'direct',
                attempt: attempt
            });
        });

        req.end();
    });
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
