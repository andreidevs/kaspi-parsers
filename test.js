const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

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

// === Тестовый парсинг одной страницы ===
async function testParseMerchantPage(page, merchantId) {
    const url = `https://kaspi.kz/shop/info/merchant/${merchantId}/review/`;

    try {
        console.log(`🔍 Переходим на: ${url}`);

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
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Ждем немного для полной загрузки - исправленная версия
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log('✅ Страница загружена, извлекаем данные...');

        const data = await page.evaluate(() => {
            // Обновленные селекторы
            const phoneElement = document.querySelector('.merchant-block__phone');
            const titleElement = document.querySelector('.merchant-block__name');
            const registerDateElement = document.querySelector('.merchant-sales-block__start-date');
            const reviewsElement = document.querySelector('.tabs-component__tab.tabs-component__tab_active');
            const ratingElement = document.querySelector('.rating-stats__calculated-rating');
            const ratingQuantityElement = document.querySelector('.rating-stats__rating-quantity');

            // Альтернативные селекторы
            const altTitleElement = document.querySelector('h1');
            const altPhoneElement = document.querySelector('[data-role="phone"]');
            
            // Функция для извлечения только цифр
            const extractNumbers = (text) => {
                if (!text) return 'НЕ НАЙДЕН';
                const numbers = text.match(/\d+/g);
                return numbers ? numbers.join('') : 'НЕ НАЙДЕН';
            };

            // Функция для очистки телефона (оставляем только цифры)
            const cleanPhone = (text) => {
                if (!text) return 'НЕ НАЙДЕН';
                const cleaned = text.replace(/\D/g, ''); // Убираем все кроме цифр
                return cleaned || 'НЕ НАЙДЕН';
            };

            // Функция для извлечения рейтинга (число с точкой)
            const extractRating = (text) => {
                if (!text) return 'НЕ НАЙДЕН';
                const rating = text.match(/\d+[.,]\d+|\d+/);
                return rating ? rating[0].replace(',', '.') : 'НЕ НАЙДЕН';
            };

            // Функция для очистки даты регистрации
            const cleanRegisterDate = (text) => {
                if (!text) return 'НЕ НАЙДЕН';
                return text.replace('В Магазине на Kaspi.kz с ', '').trim();
            };

            // Функция для очистки количества оценок
            const cleanRatingQuantity = (text) => {
                if (!text) return 'НЕ НАЙДЕН';
                return text.replace('оценок', '').trim();
            };

            const phoneText = phoneElement?.innerText?.trim();
            const reviewsText = reviewsElement?.innerText?.trim();
            const ratingText = ratingElement?.innerText?.trim();
            const registerDateText = registerDateElement?.innerText?.trim();
            const ratingQuantityText = ratingQuantityElement?.innerText?.trim();
            
            return {
                phone: cleanPhone(phoneText),
                title: titleElement?.innerText?.trim() || 'НЕ НАЙДЕН',
                registerDate: cleanRegisterDate(registerDateText),
                reviews: extractNumbers(reviewsText),
                rating: extractRating(ratingText),
                ratingQuantity: cleanRatingQuantity(ratingQuantityText),
                altTitle: altTitleElement?.innerText?.trim() || 'НЕ НАЙДЕН',
                altPhone: altPhoneElement?.innerText?.trim() || 'НЕ НАЙДЕН',
                pageTitle: document.title,
                url: window.location.href,
                bodyText: document.body.innerText.substring(0, 1000) + '...',
                // Дополнительная отладка
                phoneRaw: phoneText || 'НЕ НАЙДЕН',
                reviewsRaw: reviewsText || 'НЕ НАЙДЕН',
                ratingRaw: ratingText || 'НЕ НАЙДЕН',
                registerDateRaw: registerDateText || 'НЕ НАЙДЕН',
                ratingQuantityRaw: ratingQuantityText || 'НЕ НАЙДЕН'
            };
        });

        console.log('📊 ВСЕ ИЗВЛЕЧЕННЫЕ ДАННЫЕ:');
        console.log('Основной телефон (очищенный):', data.phone);
        console.log('Основной телефон (сырой):', data.phoneRaw);
        console.log('Основное название:', data.title);
        console.log('Дата регистрации:', data.registerDate);
        console.log('Отзывы (только цифры):', data.reviews);
        console.log('Отзывы (сырые):', data.reviewsRaw);
        console.log('Рейтинг:', data.rating);
        console.log('Рейтинг (сырой):', data.ratingRaw);
        console.log('Количество оценок:', data.ratingQuantity);
        console.log('Количество оценок (сырое):', data.ratingQuantityRaw);
        console.log('Альтернативное название (h1):', data.altTitle);
        console.log('Альтернативный телефон:', data.altPhone);
        console.log('Заголовок страницы:', data.pageTitle);
        console.log('URL страницы:', data.url);
        console.log('Начало текста страницы:', data.bodyText);

        return {
            ID: merchantId,
            title: data.title,
            phone: data.phone,
            registerDate: data.registerDate,
            reviews: data.reviews,
            rating: data.rating,
            ratingQuantity: data.ratingQuantity
        };

    } catch (error) {
        console.error(`❌ Ошибка при обработке ID ${merchantId}:`, error.message);
        return null;
    }
}

// === Тестовый запуск ===
(async () => {
    console.log('🚀 Запуск тестового парсинга...');

    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=VizDisplayCompositor'
        ]
    });

    const page = await browser.newPage();

    // Скрываем признаки автоматизации
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
    });

    // Установка случайного мобильного User-Agent
    const mobileUA = getRandomMobileUserAgent();
    console.log('📱 Используемый мобильный User-Agent:', mobileUA);
    await page.setUserAgent(mobileUA);

    const testId = 5117001;
    const result = await testParseMerchantPage(page, testId);

    if (result) {
        console.log('✅ Результат парсинга:');
        console.log(`ID: ${result.ID}`);
        console.log(`Название: ${result.title}`);
        console.log(`Телефон: ${result.phone}`);
        console.log(`Дата регистрации: ${result.registerDate}`);
        console.log(`Отзывы: ${result.reviews}`);
        console.log(`Рейтинг: ${result.rating}`);
        console.log(`Количество оценок: ${result.ratingQuantity}`);
    } else {
        console.log('❌ Парсинг не удался');
    }

    console.log('🔍 Браузер остается открытым для проверки. Нажмите Ctrl+C для завершения.');
    
    // Ждем бесконечно, чтобы браузер не закрылся
    await new Promise(() => {});
})();
