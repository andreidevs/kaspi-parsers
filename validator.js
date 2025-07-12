const fs = require('fs');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Настройки Supabase
const supabaseUrl = 'https://xnwacziuktpvayhoozlr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhud2Fjeml1a3RwdmF5aG9vemxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxNjUyODgsImV4cCI6MjA2Nzc0MTI4OH0.EJUJg4m3KD8f1KT8Hsz6uXB2PxdpftkhDdfzwYp6vzw';
const supabase = createClient(supabaseUrl, supabaseKey);

// Настройки валидатора
const CONCURRENT_REQUESTS = 20;
const BATCH_SIZE = 100; // Размер батча для получения ID из Supabase
const REQUEST_DELAY = 100; // Задержка между запросами в мс
const INVALID_IDS_FILE = 'invalid_merchant_ids.txt';

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

// Функция для получения случайного User-Agent
function getRandomUserAgent() {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Функция для получения случайного прокси
function getRandomProxy() {
    if (proxyConfigs.length === 0) return null;
    return proxyConfigs[Math.floor(Math.random() * proxyConfigs.length)];
}

// Функция для получения всех валидных ID из Supabase
async function getAllValidMerchantIds() {
    try {
        let allIds = [];
        let from = 0;
        const limit = 1000;
        
        while (true) {
            const { data, error } = await supabase
                .from('generateid_valid')
                .select('id, merchant_id, data_length, found_at')
                .range(from, from + limit - 1)
                .order('found_at', { ascending: true });

            if (error) {
                console.error('❌ Ошибка получения ID из Supabase:', error.message);
                break;
            }

            if (!data || data.length === 0) {
                break;
            }

            allIds.push(...data);
            from += limit;
            
            console.log(`📥 Загружено ${allIds.length} ID из базы...`);
        }

        console.log(`✅ Всего загружено ${allIds.length} ID для валидации`);
        return allIds;
    } catch (error) {
        console.error('❌ Критическая ошибка получения ID:', error.message);
        return [];
    }
}

// Функция для проверки актуальности ID
async function validateMerchantId(merchantRecord, attempt = 1, maxAttempts = 3) {
    const merchantId = merchantRecord.merchant_id;
    const url = `https://kaspi.kz/yml/review-view/api/v1/reviews/merchant/${merchantId}`;
    const userAgent = getRandomUserAgent();
    const proxyConfig = getRandomProxy();

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
            console.log(`⚠️ 429 ошибка для ID ${merchantId}, попытка ${attempt}/${maxAttempts}. Повтор через 200мс...`);
            await new Promise(resolve => setTimeout(resolve, 200));
            return validateMerchantId(merchantRecord, attempt + 1, maxAttempts);
        }

        // Проверяем что ответ успешный и есть данные
        const hasData = response.status === 200 && 
                       response.data && 
                       response.data.data && 
                       Array.isArray(response.data.data) && 
                       response.data.data.length > 0;

        return {
            merchantRecord: merchantRecord,
            statusCode: response.status,
            success: response.status === 200,
            hasData: hasData,
            currentDataLength: response.data?.data?.length || 0,
            originalDataLength: merchantRecord.data_length,
            isValid: hasData,
            attempt: attempt
        };

    } catch (error) {
        // При ошибке сети тоже можем повторить
        if (attempt < maxAttempts && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND')) {
            console.log(`⚠️ Ошибка сети для ID ${merchantId}, попытка ${attempt}/${maxAttempts}. Повтор через 300мс...`);
            await new Promise(resolve => setTimeout(resolve, 300));
            return validateMerchantId(merchantRecord, attempt + 1, maxAttempts);
        }

        return {
            merchantRecord: merchantRecord,
            statusCode: 0,
            success: false,
            hasData: false,
            currentDataLength: 0,
            originalDataLength: merchantRecord.data_length,
            isValid: false,
            error: error.message,
            attempt: attempt
        };
    }
}

// Функция для удаления невалидного ID из Supabase
async function removeInvalidId(merchantRecord) {
    try {
        const { error } = await supabase
            .from('generateid_valid')
            .delete()
            .eq('id', merchantRecord.id);

        if (error) {
            console.error(`❌ Ошибка удаления ID ${merchantRecord.merchant_id} из Supabase:`, error.message);
            return false;
        } else {
            console.log(`🗑️ ID ${merchantRecord.merchant_id} удален из базы (невалидный)`);
            return true;
        }
    } catch (error) {
        console.error(`❌ Критическая ошибка удаления ID ${merchantRecord.merchant_id}:`, error.message);
        return false;
    }
}

// Функция для обновления данных валидного ID
async function updateValidId(merchantRecord, newDataLength) {
    try {
        const { error } = await supabase
            .from('generateid_valid')
            .update({ 
                data_length: newDataLength,
                updated_at: new Date().toISOString()
            })
            .eq('id', merchantRecord.id);

        if (error) {
            console.error(`❌ Ошибка обновления ID ${merchantRecord.merchant_id}:`, error.message);
            return false;
        } else {
            console.log(`🔄 ID ${merchantRecord.merchant_id} обновлен (${merchantRecord.data_length} → ${newDataLength} отзывов)`);
            return true;
        }
    } catch (error) {
        console.error(`❌ Критическая ошибка обновления ID ${merchantRecord.merchant_id}:`, error.message);
        return false;
    }
}

// Функция для логирования невалидных ID
function logInvalidId(merchantRecord, reason) {
    const logEntry = `${merchantRecord.merchant_id} | ${reason} | ${new Date().toISOString()}\n`;
    fs.appendFileSync(INVALID_IDS_FILE, logEntry);
}

// Главная функция валидации
(async () => {
    console.log('🔍 Запуск валидатора ID...');
    console.log(`📊 Настройки: ${CONCURRENT_REQUESTS} одновременных запросов, задержка ${REQUEST_DELAY}мс`);

    // Получаем все ID из базы
    const allMerchantRecords = await getAllValidMerchantIds();
    
    if (allMerchantRecords.length === 0) {
        console.log('❌ Нет ID для валидации');
        return;
    }

    let processedCount = 0;
    let validCount = 0;
    let invalidCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    // Функция для обработки одного ID
    async function processValidation(merchantRecord) {
        try {
            const result = await validateMerchantId(merchantRecord);

            if (result.isValid) {
                if (result.currentDataLength !== result.originalDataLength) {
                    const updateSuccess = await updateValidId(merchantRecord, result.currentDataLength);
                    if (updateSuccess) {
                        updatedCount++;
                    } else {
                        errorCount++;
                    }
                } else {
                    validCount++;
                }
            } else {
                const deleteSuccess = await removeInvalidId(merchantRecord);
                if (deleteSuccess) {
                    invalidCount++;
                    logInvalidId(merchantRecord, 'Нет данных или ошибка при запросе');
                } else {
                    errorCount++;
                }
            }
        } catch (error) {
            console.error(`❌ Ошибка при обработке ID ${merchantRecord.merchant_id}:`, error.message);
            errorCount++;
        } finally {
            processedCount++;
            console.log(`📊 Прогресс: ${processedCount}/${allMerchantRecords.length} | Валидно: ${validCount} | Невалидно: ${invalidCount} | Обновлено: ${updatedCount} | Ошибок: ${errorCount}`);
        }
    }

    // Очередь для управления одновременными запросами
    const queue = [];
    for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
        queue.push(Promise.resolve());
    }

    // Обработка всех записей
    for (const merchantRecord of allMerchantRecords) {
        const promise = queue.shift().then(() => processValidation(merchantRecord).then(() => {
            return new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
        }));
        queue.push(promise);
    }

    // Ждем завершения всех запросов
    await Promise.all(queue);

    console.log('🏁 Валидация завершена');
    console.log(`📊 Итоги: Валидно: ${validCount} | Невалидно: ${invalidCount} | Обновлено: ${updatedCount} | Ошибок: ${errorCount}`);
})();
