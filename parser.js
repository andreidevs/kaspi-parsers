const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const ExcelJS = require('exceljs');

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
const OUTPUT_FILE = 'kaspi_merchants_random_ids.xlsx';
const ID_LOG_FILE = 'processed_ids.txt';
const TOTAL_REQUESTS = 1000000;       // Максимум попыток парсинга
const SAVE_INTERVAL = 60000;       // Сохранять данные каждые 60 секунд
const MIN_ID_LENGTH = 7;
const MAX_ID_LENGTH = 8;

// === Инициализация Excel ===
const workbook = new ExcelJS.Workbook();
let worksheet;

// === Чтение уже обработанных ID из файла ===
let processedIds = new Set();

if (fs.existsSync(ID_LOG_FILE)) {
    const data = fs.readFileSync(ID_LOG_FILE, 'utf-8');
    data.split('\n').forEach(id => {
        if (id.trim()) processedIds.add(id.trim());
    });
}

// === Функция для генерации 7-8 значного ID ===
function getRandomId(minLength = MIN_ID_LENGTH, maxLength = MAX_ID_LENGTH) {
    const min = Math.pow(10, minLength - 1);      // 1_000_000
    const max = Math.pow(10, maxLength) - 1;      // 99_999_999
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// === Парсинг одной страницы ===
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

        return {
            ID: merchantId,
            title: data.title || null,
            phone: data.phone || null,
            registerDate: data.registerDate || null,
            reviews: data.reviews || null,
            rating: data.rating || null,
            ratingQuantity: data.ratingQuantity || null
        };

    } catch (error) {
        console.error(`Ошибка при обработке ID ${merchantId}:`, error.message);
        return null;
    }
}

// === Загрузка Excel файла или создание нового ===
async function loadOrCreateWorksheet() {
    if (fs.existsSync(OUTPUT_FILE)) {
        await workbook.xlsx.readFile(OUTPUT_FILE);
        worksheet = workbook.getWorksheet('Магазины');
    } else {
        worksheet = workbook.addWorksheet('Магазины');
        worksheet.columns = [
            {header: 'ID', key: 'ID', width: 10},
            {header: 'Название магазина', key: 'title', width: 30},
            {header: 'Телефон', key: 'phone', width: 20},
            {header: 'Дата регистрации', key: 'registerDate', width: 20},
            {header: 'Количество отзывов', key: 'reviews', width: 20},
            {header: 'Рейтинг', key: 'rating', width: 15},
            {header: 'Количество оценок', key: 'ratingQuantity', width: 20}
        ];
    }
}

// === Сохранение данных в Excel ===
async function saveDataToFile() {
    try {
        await workbook.xlsx.writeFile(OUTPUT_FILE);
        console.log('💾 Данные сохранены в Excel файл');
    } catch (error) {
        console.error('❌ Ошибка при сохранении:', error.message);
    }
}

// === Запись обработанного ID в лог ===
function logProcessedId(id) {
    fs.appendFileSync(ID_LOG_FILE, `${id}\n`);
    processedIds.add(id.toString());
}

// === Основной цикл ===
(async () => {
    await loadOrCreateWorksheet();

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
    const CONCURRENT_PAGES = 20; // Количество одновременных страниц

    // Таймер для периодического сохранения
    const saveTimer = setInterval(saveDataToFile, SAVE_INTERVAL);

    // Счетчики для статистики
    let foundMerchants = 0;
    let skippedMerchants = 0;

    // Функция для обработки одного ID
    async function processId() {
        if (completedRequests >= TOTAL_REQUESTS) return;

        let merchantId;
        do {
            merchantId = getRandomId();
        } while (processedIds.has(merchantId.toString()));

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
                if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            const result = await parseMerchantPage(page, merchantId);

            if (result && result.title) {
                worksheet.addRow(result);
                foundMerchants++;
                console.log(`✅ Добавлено: ${result.title}`);
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
                // Пауза 100мс между запросами
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        })());
    }

    await Promise.all(promises);

    clearInterval(saveTimer);
    await saveDataToFile();
    await browser.close();

    console.log('✅ Парсинг завершён. Все данные сохранены.');
})();
