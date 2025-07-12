const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { createClient } = require('@supabase/supabase-js');

// Настройки Supabase
const supabaseUrl = 'https://xnwacziuktpvayhoozlr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhud2Fjeml1a3RwdmF5aG9vemxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxNjUyODgsImV4cCI6MjA2Nzc0MTI4OH0.EJUJg4m3KD8f1KT8Hsz6uXB2PxdpftkhDdfzwYp6vzw';
const supabase = createClient(supabaseUrl, supabaseKey);

// Массив мобильных User-Agent
const mobileUserAgents = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 12; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.6 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36'
];

// Функция для получения случайного мобильного User-Agent
function getRandomMobileUserAgent() {
    return mobileUserAgents[Math.floor(Math.random() * mobileUserAgents.length)];
}

// Настройки
const ID_LOG_FILE = 'processed_merchant_ids.txt';
let TOTAL_REQUESTS = 1000000; // Значение по умолчанию
const SAVE_INTERVAL = 60000;
const CONCURRENT_PAGES = 10;
const BATCH_SIZE = 1000; // Размер батча для получения ID из Supabase

// Функция для получения общего количества валидных ID из Supabase
async function getTotalValidMerchantIds() {
    try {
        const { count, error } = await supabase
            .from('generateid_valid')
            .select('*', { count: 'exact', head: true });

        if (error) {
            console.error('❌ Ошибка получения количества ID из Supabase:', error.message);
            return 1000000; // Возвращаем значение по умолчанию
        }

        console.log(`📊 Найдено ${count} валидных ID в базе данных`);
        return count || 1000000;
    } catch (error) {
        console.error('❌ Критическая ошибка получения количества ID:', error.message);
        return 1000000; // Возвращаем значение по умолчанию
    }
}

// Чтение уже обработанных ID из файла
let processedIds = new Set();

if (fs.existsSync(ID_LOG_FILE)) {
    const data = fs.readFileSync(ID_LOG_FILE, 'utf-8');
    data.split('\n').forEach(id => {
        if (id.trim()) processedIds.add(id.trim());
    });
}

// Функция для получения валидных ID из Supabase
async function getValidMerchantIds(limit = BATCH_SIZE) {
    try {
        const { data, error } = await supabase
            .from('generateid_valid')
            .select('merchant_id')
            .order('found_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('❌ Ошибка получения ID из Supabase:', error.message);
            return [];
        }

        return data.map(item => item.merchant_id);
    } catch (error) {
        console.error('❌ Критическая ошибка получения ID:', error.message);
        return [];
    }
}

// Функция для сохранения результата в Supabase
async function saveMerchantDataToSupabase(merchantData) {
    try {
        const record = {
            merchant_id: parseInt(merchantData.ID),
            title: merchantData.title,
            phone: merchantData.phone,
            register_date: merchantData.registerDate,
            reviews_count: merchantData.reviews ? parseInt(merchantData.reviews) : null,
            rating: merchantData.rating ? parseFloat(merchantData.rating) : null,
            rating_quantity: merchantData.ratingQuantity ? parseInt(merchantData.ratingQuantity) : null,
            products_count: merchantData.productsCount ? parseInt(merchantData.productsCount) : null,
            categories: merchantData.categories && merchantData.categories.length > 0 ? merchantData.categories : null,
            parsed_at: new Date().toISOString()
        };

        const { error } = await supabase
            .from('merchant_details')
            .insert([record]);

        if (error) {
            console.error(`❌ Ошибка сохранения данных для ID ${merchantData.ID}:`, error.message);
            return false;
        } else {
            console.log(`💾 Данные для ID ${merchantData.ID} сохранены в Supabase`);
            return true;
        }

    } catch (error) {
        console.error(`❌ Критическая ошибка сохранения ID ${merchantData.ID}:`, error.message);
        return false;
    }
}

// Парсинг одной страницы
async function parseMerchantPage(page, merchantId) {
    const url = `https://kaspi.kz/shop/info/merchant/${merchantId}/review/`;

    try {
        // Добавляем заголовки для имитации реального мобильного браузера
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        });

        // Устанавливаем мобильный viewport
        await page.setViewport({ 
            width: 375, 
            height: 667, 
            isMobile: true,
            hasTouch: true,
            deviceScaleFactor: 2
        });

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
        });

        // Ждем немного для полной загрузки
        await new Promise(resolve => setTimeout(resolve, 1000));

        const data = await page.evaluate(() => {
            // Обновленные селекторы для мобильной версии
            const phoneElement = document.querySelector('.merchant-block__phone');
            const titleElement = document.querySelector('.merchant-block__name');
            const registerDateElement = document.querySelector('.merchant-sales-block__start-date');
            const reviewsElement = document.querySelector('.tabs-component__tab.tabs-component__tab_active');
            const ratingElement = document.querySelector('.rating-stats__calculated-rating');
            const ratingQuantityElement = document.querySelector('.rating-stats__rating-quantity');

            // Функция для извлечения только цифр
            const extractNumbers = (text) => {
                if (!text) return null;
                const numbers = text.match(/\d+/g);
                return numbers ? numbers.join('') : null;
            };

            // Функция для очистки телефона (оставляем только цифры)
            const cleanPhone = (text) => {
                if (!text) return null;
                const cleaned = text.replace(/\D/g, '');
                return cleaned || null;
            };

            // Функция для извлечения рейтинга (число с точкой)
            const extractRating = (text) => {
                if (!text) return null;
                const rating = text.match(/\d+[.,]\d+|\d+/);
                return rating ? rating[0].replace(',', '.') : null;
            };

            // Функция для очистки даты регистрации
            const cleanRegisterDate = (text) => {
                if (!text) return null;
                return text.replace('В Магазине на Kaspi.kz с ', '').trim();
            };

            // Функция для очистки количества оценок
            const cleanRatingQuantity = (text) => {
                if (!text) return null;
                return text.replace('оценок', '').trim();
            };

            const phoneText = phoneElement?.innerText?.trim();
            const reviewsText = reviewsElement?.innerText?.trim();
            const ratingText = ratingElement?.innerText?.trim();
            const registerDateText = registerDateElement?.innerText?.trim();
            const ratingQuantityText = ratingQuantityElement?.innerText?.trim();

            return {
                phone: cleanPhone(phoneText),
                title: titleElement?.innerText?.trim() || null,
                registerDate: cleanRegisterDate(registerDateText),
                reviews: extractNumbers(reviewsText),
                rating: extractRating(ratingText),
                ratingQuantity: cleanRatingQuantity(ratingQuantityText)
            };
        });

        let productsCount = null;
        let categories = [];

        // Второй этап: парсинг количества товаров и категорий, если найден title
        if (data.title) {
            try {
                console.log(`🔍 Второй этап: получаем количество товаров и категории для ${data.title}`);
                
                const searchUrl = `https://kaspi.kz/shop/search/?q=%3AallMerchants%3A${merchantId}`;
                await page.goto(searchUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 15000
                });

                // Ждем загрузки страницы
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Ищем и кликаем на кнопку фильтров
                const filtersButton = await page.$('[data-test-id="filters-button"]');
                if (filtersButton) {
                    await filtersButton.click();
                    console.log('🔘 Кнопка фильтров нажата');

                    // Ждем появления диалога фильтров
                    await new Promise(resolve => setTimeout(resolve, 1500));

                    // Получаем количество товаров из кнопки применения фильтров
                    const productsCountText = await page.evaluate(() => {
                        const submitButton = document.querySelector('[data-test-id="FilterDialogComponent-filterSubmitButton"]');
                        return submitButton ? submitButton.innerText.trim() : null;
                    });

                    if (productsCountText) {
                        // Извлекаем только цифры
                        const numbers = productsCountText.match(/\d+/g);
                        productsCount = numbers ? numbers.join('') : null;
                        console.log(`📦 Найдено товаров: ${productsCount}`);
                    } else {
                        console.log('⚠️ Не удалось найти кнопку с количеством товаров');
                    }

                    // Парсинг категорий
                    try {
                        // Ищем и кликаем на кнопку категорий
                        const categoryButton = await page.$('[data-test-id="FilterListCategoryComponent-categoryFilterTitle"]');
                        if (categoryButton) {
                            await categoryButton.click();
                            console.log('🏷️ Кнопка категорий нажата');

                            // Ждем появления списка категорий
                            await new Promise(resolve => setTimeout(resolve, 1000));

                            // Получаем все категории
                            const categoryTitles = await page.evaluate(() => {
                                const categoryElements = document.querySelectorAll('.catalog-sub-item__title');
                                return Array.from(categoryElements).map(element => element.innerText.trim());
                            });

                            if (categoryTitles.length > 0) {
                                categories = categoryTitles;
                                console.log(`🏷️ Найдено категорий: ${categories.length} - ${categories.join(', ')}`);
                            } else {
                                console.log('⚠️ Категории не найдены');
                            }
                        } else {
                            console.log('⚠️ Кнопка категорий не найдена');
                        }
                    } catch (categoryError) {
                        console.error(`❌ Ошибка при получении категорий для ID ${merchantId}:`, categoryError.message);
                    }

                } else {
                    console.log('⚠️ Кнопка фильтров не найдена');
                }
            } catch (error) {
                console.error(`❌ Ошибка при получении данных товаров для ID ${merchantId}:`, error.message);
            }
        }

        return {
            ID: merchantId,
            title: data.title || null,
            phone: data.phone || null,
            registerDate: data.registerDate || null,
            reviews: data.reviews || null,
            rating: data.rating || null,
            ratingQuantity: data.ratingQuantity || null,
            productsCount: productsCount,
            categories: categories
        };

    } catch (error) {
        console.error(`Ошибка при обработке ID ${merchantId}:`, error.message);
        return null;
    }
}

// Запись обработанного ID в лог
function logProcessedId(id) {
    fs.appendFileSync(ID_LOG_FILE, `${id}\n`);
    processedIds.add(id.toString());
}

// Проверка доступности Chrome на Linux


// Основной цикл
(async () => {
    console.log('🚀 Запуск парсера с подключением к Supabase...');
    
    // Получаем общее количество валидных ID из базы
    TOTAL_REQUESTS = await getTotalValidMerchantIds();
    console.log(`🎯 Установлено максимальное количество запросов: ${TOTAL_REQUESTS}`);

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    let completedRequests = 0;
    let foundMerchants = 0;
    let skippedMerchants = 0;
    let merchantIds = [];
    let currentIndex = 0;

    // Функция для загрузки новой порции ID
    async function loadMerchantIds() {
        console.log('📥 Загружаем новую порцию валидных ID из Supabase...');
        const newIds = await getValidMerchantIds(BATCH_SIZE);
        
        if (newIds.length === 0) {
            console.log('⚠️ Не удалось получить новые ID из Supabase');
            return false;
        }

        // Фильтруем уже обработанные ID
        const unprocessedIds = newIds.filter(id => !processedIds.has(id.toString()));
        merchantIds.push(...unprocessedIds);
        
        console.log(`✅ Загружено ${newIds.length} ID, из них ${unprocessedIds.length} новых`);
        return true;
    }

    // Загружаем первую порцию ID
    await loadMerchantIds();

    // Функция для обработки одного ID
    async function processId() {
        if (completedRequests >= TOTAL_REQUESTS) return;

        // Если ID закончились, загружаем новые
        if (currentIndex >= merchantIds.length) {
            const loaded = await loadMerchantIds();
            if (!loaded) {
                console.log('❌ Не удалось загрузить новые ID, завершаем работу');
                return;
            }
        }

        const merchantId = merchantIds[currentIndex++];
        if (!merchantId) return;

        const page = await browser.newPage();

        try {
            // Скрываем признаки автоматизации
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined,
                });
            });

            // Установка случайного мобильного User-Agent
            const mobileUA = getRandomMobileUserAgent();
            await page.setUserAgent(mobileUA);

            // Отключение ненужных ресурсов
            await page.setRequestInterception(true);
            page.on('request', req => {
                if (['image', 'font', 'media'].includes(req.resourceType())) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            const result = await parseMerchantPage(page, merchantId);

            if (result && result.title) {
                // Сохраняем в Supabase вместо Excel
                const saved = await saveMerchantDataToSupabase(result);
                if (saved) {
                    foundMerchants++;
                    console.log(`✅ Добавлено: ${result.title} (ID: ${merchantId})`);
                }
            } else {
                skippedMerchants++;
            }

            // Выводим статистику каждые 10 запросов
            if ((completedRequests + 1) % 10 === 0) {
                console.log(`📊 Статистика: Найдено ${foundMerchants}, Пропущено ${skippedMerchants}, Всего обработано ${completedRequests + 1}/${TOTAL_REQUESTS}`);
                console.log('─'.repeat(50));
            }

            logProcessedId(merchantId);
            completedRequests++;

        } catch (error) {
            console.error(`💥 Ошибка при обработке ID ${merchantId}:`, error.message);
            logProcessedId(merchantId);
            completedRequests++;
        } finally {
            await page.close();
        }
    }

    // Запуск параллельных процессов
    const promises = [];
    for (let i = 0; i < CONCURRENT_PAGES; i++) {
        promises.push((async () => {
            while (completedRequests < TOTAL_REQUESTS) {
                await processId();
                // Пауза 10мс между запросами
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        })());
    }

    await Promise.all(promises);

    await browser.close();

    console.log('✅ Парсинг завершён. Все данные сохранены.');
})();
