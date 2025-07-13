const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');
puppeteer.use(StealthPlugin());

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

// Функция для извлечения всех merchant ID из URL
function extractAllMerchantIds(url) {
    const regex = /3AallMerchants%3A([^%3A&]+)/g;
    const merchantIds = [];
    let match;
    
    while ((match = regex.exec(url)) !== null) {
        const merchantId = match[1];
        // Добавляем все найденные ID (и цифры, и строки)
        merchantIds.push(merchantId);
    }
    
    return merchantIds;
}

// Функция для сохранения батча ID в Supabase
async function saveBatchToSupabase(merchantIds, category, sourceUrl) {
    if (merchantIds.length === 0) return;

    try {
        // Удаляем дубликаты из массива перед сохранением
        const uniqueMerchantIds = [...new Set(merchantIds)];
        
        // Сначала проверяем какие ID уже существуют
        const { data: existingIds, error: selectError } = await supabase
            .from('searched_id')
            .select('merchant_id')
            .in('merchant_id', uniqueMerchantIds);

        if (selectError) {
            console.error('❌ Ошибка проверки существующих ID:', selectError.message);
            return false;
        }

        // Получаем список уже существующих ID
        const existingMerchantIds = new Set(existingIds.map(item => item.merchant_id));
        
        // Фильтруем только новые ID
        const newMerchantIds = uniqueMerchantIds.filter(id => !existingMerchantIds.has(id));

        if (newMerchantIds.length === 0) {
            console.log(`⚠️ Все ID из батча уже существуют в базе для категории: ${category}`);
            return true;
        }

        const records = newMerchantIds.map(id => ({
            merchant_id: id,
            category: category,
            source_url: sourceUrl,
            found_at: new Date().toISOString()
        }));

        // Вставляем только новые записи
        const { error } = await supabase
            .from('searched_id')
            .insert(records);

        if (error) {
            console.error('❌ Ошибка вставки батча в Supabase:', error.message);
            return false;
        } else {
            console.log(`💾 Батч из ${records.length} новых ID сохранен в Supabase для категории: ${category}`);
            console.log(`📋 Новые ID: ${newMerchantIds.join(', ')}`);
            if (existingMerchantIds.size > 0) {
                console.log(`🔄 Пропущено ${uniqueMerchantIds.length - newMerchantIds.length} уже существующих ID`);
            }
            return true;
        }

    } catch (error) {
        console.error('❌ Критическая ошибка сохранения батча:', error.message);
        return false;
    }
}

// Функция для скроллинга списка продавцов и загрузки всех элементов
async function scrollAndLoadAllSellers(page) {
    console.log('📜 Скроллим список продавцов для загрузки всех элементов...');
    
    let previousCount = 0;
    let currentCount = 0;
    let attempts = 0;
    const maxAttempts = 10;

    do {
        previousCount = currentCount;
        
        // Скроллим внутри контейнера со списком продавцов
        await page.evaluate(() => {
            const container = document.querySelector('.filter-list-submenu');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        });

        // Ждем загрузки новых элементов
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Подсчитываем текущее количество продавцов
        currentCount = await page.evaluate(() => {
            const items = document.querySelectorAll('.filter-list-submenu__item');
            return items.length;
        });

        console.log(`📊 Загружено продавцов: ${currentCount}`);
        attempts++;

    } while (currentCount > previousCount && attempts < maxAttempts);

    console.log(`✅ Скроллинг завершен. Итого продавцов: ${currentCount}`);
    return currentCount;
}

// Функция для выбора продавцов батчами по 100 штук
async function selectSellersBatch(page, startIndex, batchSize = 100) {
    console.log(`🔘 Выбираем продавцов с ${startIndex} по ${startIndex + batchSize - 1}...`);
    
    // Сначала снимаем ВСЕ выделения с уже отмеченных элементов
    console.log('🔄 Снимаем все предыдущие выделения...');
    const deselectedCount = await page.evaluate(() => {
        const selectedItems = document.querySelectorAll('.filter-list-submenu__item_selected');
        let deselected = 0;
        selectedItems.forEach(item => {
            item.click();
            deselected++;
        });
        return deselected;
    });

    if (deselectedCount > 0) {
        console.log(`✅ Снято выделений: ${deselectedCount}`);
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Теперь выбираем продавцов в указанном диапазоне
    console.log(`🎯 Выбираем новый батч продавцов...`);
    const selectedCount = await page.evaluate((start, size) => {
        const items = document.querySelectorAll('.filter-list-submenu__item');
        let selected = 0;
        
        for (let i = start; i < Math.min(start + size, items.length); i++) {
            if (items[i] && !items[i].classList.contains('filter-list-submenu__item_selected')) {
                items[i].click();
                selected++;
            }
        }
        
        return selected;
    }, startIndex, batchSize);

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log(`✅ Выбрано ${selectedCount} продавцов в новом батче`);
    return selectedCount;
}

// Функция для обработки всех продавцов батчами
async function processAllSellersBatches(page, totalSellers, categoryName) {
    const batchSize = 100;
    const totalBatches = Math.ceil(totalSellers / batchSize);
    let allMerchantIds = [];
    
    console.log(`📦 Обрабатываем ${totalSellers} продавцов в ${totalBatches} батчах по ${batchSize} штук`);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const startIndex = batchIndex * batchSize;
        const currentBatchSize = Math.min(batchSize, totalSellers - startIndex);
        
        console.log(`\n🔄 Батч ${batchIndex + 1}/${totalBatches} (продавцы ${startIndex + 1}-${startIndex + currentBatchSize})`);

        try {
            // Скроллим к нужной позиции в списке продавцов
            await page.evaluate((index) => {
                const container = document.querySelector('.filter-list-submenu');
                const items = document.querySelectorAll('.filter-list-submenu__item');
                if (container && items[index]) {
                    items[index].scrollIntoView({ block: 'center' });
                }
            }, startIndex);

            await new Promise(resolve => setTimeout(resolve, 1000));

            // Выбираем продавцов в текущем батче
            const selectedCount = await selectSellersBatch(page, startIndex, currentBatchSize);

            if (selectedCount === 0) {
                console.log('⚠️ Не удалось выбрать продавцов в текущем батче, пропускаем');
                continue;
            }

            // Применяем фильтр
            console.log('🔍 Применяем фильтр для текущего батча...');
            const buttonClicked = await page.evaluate(() => {
                const buttons = document.querySelectorAll('button.button._big._space._blue.g-mt0');
                for (const button of buttons) {
                    if (button.innerText.trim() === 'Применить') {
                        button.click();
                        return true;
                    }
                }
                return false;
            });

            if (!buttonClicked) {
                console.log('⚠️ Кнопка "Применить" не найдена для текущего батча');
                continue;
            }

            await new Promise(resolve => setTimeout(resolve, 3000));

            // Получаем merchant IDs для текущего батча
            const currentUrl = page.url();
            const batchMerchantIds = extractAllMerchantIds(currentUrl);

            if (batchMerchantIds.length > 0) {
                console.log(`✅ Найдено ${batchMerchantIds.length} merchant IDs в батче: ${batchMerchantIds.join(', ')}`);
                
                // Сохраняем батч в Supabase
                const saveSuccess = await saveBatchToSupabase(batchMerchantIds, categoryName, currentUrl);
                
                if (saveSuccess) {
                    allMerchantIds.push(...batchMerchantIds);
                    console.log(`💾 Батч ${batchIndex + 1} сохранен. ID в батче: ${batchMerchantIds.length}`);
                } else {
                    console.error(`❌ Ошибка сохранения батча ${batchIndex + 1}`);
                }
            } else {
                console.log(`⚠️ Merchant IDs не найдены в батче ${batchIndex + 1}`);
            }

            // Возвращаемся к фильтрам для следующего батча (если это не последний)
            if (batchIndex < totalBatches - 1) {
                console.log('🔄 Возвращаемся к фильтрам для следующего батча...');
                
                // Для последующих батчей просто нажимаем на активную кнопку фильтра
                const sellersButtonClicked = await page.evaluate(() => {
                    const activeButton = document.querySelector('.chip-filter.chip-filter_active');
                    if (activeButton) {
                        activeButton.click();
                        return true;
                    }
                    return false;
                });

                if (sellersButtonClicked) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Ждем появления списка продавцов
                    try {
                        await page.waitForSelector('.filter-list-submenu__item', { timeout: 5000 });
                    } catch (waitError) {
                        console.log('⚠️ Список продавцов не загрузился для следующего батча');
                        break;
                    }
                } else {
                    console.log('⚠️ Не удалось вернуться к фильтрам продавцов');
                    break;
                }
            }

            // Пауза между батчами
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            console.error(`❌ Ошибка при обработке батча ${batchIndex + 1}:`, error.message);
            continue;
        }
    }

    console.log(`🎯 Обработка категории "${categoryName}" завершена. Всего найдено ${allMerchantIds.length} уникальных merchant IDs`);
    return allMerchantIds;
}

// Функция для получения merchant IDs с повторными попытками
async function getMerchantIdsWithRetry(page, expectedCount, categoryName) {
    let merchantIds = [];
    let attempts = 0;
    const maxAttempts = 3;

    while (merchantIds.length < expectedCount && attempts < maxAttempts) {
        attempts++;
        console.log(`🔍 Попытка ${attempts}/${maxAttempts} получения merchant IDs...`);

        // Получаем URL и извлекаем merchant IDs
        const currentUrl = page.url();
        merchantIds = extractAllMerchantIds(currentUrl);

        console.log(`📊 Найдено ${merchantIds.length} merchant IDs из ожидаемых ${expectedCount}`);

        if (merchantIds.length < expectedCount) {
            console.log('⏳ Ждем дополнительную загрузку данных...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Обновляем страницу если нужно
            if (attempts < maxAttempts) {
                await page.reload({ waitUntil: 'domcontentloaded' });
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }

    if (merchantIds.length < expectedCount) {
        console.log(`⚠️ Получено только ${merchantIds.length} из ${expectedCount} ожидаемых merchant IDs для категории "${categoryName}"`);
    } else {
        console.log(`✅ Получены все ${merchantIds.length} merchant IDs для категории "${categoryName}"`);
    }

    return merchantIds;
}

// Функция для получения подкатегорий
async function getSubcategories(page) {
    const subcategories = await page.evaluate(() => {
        const result = [];
        
        // Ищем элементы с классами category-grid-item, grid__item, tiles__item
        const selectors = [
            'a.category-grid-item',
            'a.grid__item', 
            'a.tiles__item'
        ];
        
        selectors.forEach(selector => {
            const items = document.querySelectorAll(selector);
            items.forEach(item => {
                // Извлекаем href из ссылки
                let href = item.getAttribute('href');
                
                if (href) {
                    // Нормализуем href
                    if (href.startsWith('https://kaspi.kz')) {
                        // Ссылка с доменом - оставляем как есть, только убираем домен для хранения
                        href = href.replace('https://kaspi.kz', '');
                    } else {
                        // Ссылка без домена - добавляем /shop/ если его нет
                        if (!href.startsWith('/shop/') && !href.startsWith('shop/')) {
                            href = '/shop/' + href;
                        } else if (href.startsWith('shop/')) {
                            href = '/' + href;
                        }
                    }
                    
                    // Убеждаемся что href начинается с /
                    if (!href.startsWith('/')) {
                        href = '/' + href;
                    }
                    
                    // Получаем текст для названия
                    let text = item.innerText?.trim() || href || 'Без названия';
                    
                    result.push({ 
                        text, 
                        href, 
                        type: selector.replace('a.', '') 
                    });
                }
            });
        });
        
        return result;
    });
    
    return subcategories;
}

// Функция для обработки одной подкатегории
async function processSubcategory(page, subcategory, categoryName) {
    console.log(`\n🏷️ Обрабатываем подкатегорию: ${subcategory.text} (${subcategory.type})`);
    
    try {
        // Переходим по ссылке подкатегории (без добавления "all/")
        const subcategoryUrl = `https://kaspi.kz${subcategory.href}`;
        console.log(`🔗 Переходим на: ${subcategoryUrl}`);

        await page.goto(subcategoryUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // Время ожидания для загрузки страницы с товарами
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Проверяем, что мы на странице с товарами (ищем фильтры)
        const hasFilters = await page.evaluate(() => {
            return document.querySelectorAll('.chip-filter').length > 0;
        });

        if (!hasFilters) {
            console.log('⚠️ Фильтры не найдены на странице, возможно это не страница с товарами');
            return [];
        }

        console.log('✅ Страница с товарами загружена, ищем фильтры');

        // Ищем и кликаем на кнопку "Продавцы"
        console.log('🔍 Ищем кнопку "Продавцы"...');
        const sellersButtonExists = await page.evaluate(() => {
            const buttons = document.querySelectorAll('.chip-filter');
            for (const button of buttons) {
                const textElement = button.querySelector('.chip-filter__text');
                if (textElement && textElement.innerText.trim() === 'Продавцы') {
                    return true;
                }
            }
            return false;
        });

        if (!sellersButtonExists) {
            console.log('⚠️ Кнопка "Продавцы" не найдена, пропускаем подкатегорию');
            return [];
        }

        // Кликаем на кнопку "Продавцы"
        await page.evaluate(() => {
            const buttons = document.querySelectorAll('.chip-filter');
            for (const button of buttons) {
                const textElement = button.querySelector('.chip-filter__text');
                if (textElement && textElement.innerText.trim() === 'Продавцы') {
                    button.click();
                    break;
                }
            }
        });

        console.log('✅ Кнопка "Продавцы" нажата');
        
        // Увеличиваем время ожидания после клика на "Продавцы"
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Ждем появления списка продавцов
        try {
            await page.waitForSelector('.filter-list-submenu__item', { timeout: 10000 });
            console.log('✅ Список продавцов загружен');
        } catch (waitError) {
            console.log('⚠️ Список продавцов не загрузился, пропускаем подкатегорию');
            return [];
        }

        // Скроллим и загружаем всех продавцов
        const totalSellers = await scrollAndLoadAllSellers(page);

        console.log(`👥 Найдено ${totalSellers} продавцов в подкатегории`);

        if (totalSellers === 0) {
            console.log('⚠️ Продавцы не найдены, пропускаем подкатегорию');
            return [];
        }

        // Обрабатываем всех продавцов батчами по 100 штук
        const subcategoryName = `${categoryName} > ${subcategory.text}`;
        const subcategoryMerchantIds = await processAllSellersBatches(page, totalSellers, subcategoryName);

        if (subcategoryMerchantIds.length > 0) {
            console.log(`💾 Подкатегория "${subcategory.text}" полностью обработана. Найдено ID: ${subcategoryMerchantIds.length}`);
        } else {
            console.log(`⚠️ В подкатегории "${subcategory.text}" не найдено ни одного merchant ID`);
        }

        return subcategoryMerchantIds;

    } catch (error) {
        console.error(`❌ Ошибка при обработке подкатегории "${subcategory.text}":`, error.message);
        return [];
    }
}

// Добавляем функцию для обработки страниц с товарами (когда подкатегорий нет)
async function processProductPage(page, categoryName) {
    console.log(`🛍️ Обрабатываем страницу с товарами для категории: ${categoryName}`);
    
    try {
        // Ищем и кликаем на кнопку "Продавцы"
        console.log('🔍 Ищем кнопку "Продавцы"...');
        const sellersButtonExists = await page.evaluate(() => {
            const buttons = document.querySelectorAll('.chip-filter');
            for (const button of buttons) {
                const textElement = button.querySelector('.chip-filter__text');
                if (textElement && textElement.innerText.trim() === 'Продавцы') {
                    return true;
                }
            }
            return false;
        });

        if (!sellersButtonExists) {
            console.log('⚠️ Кнопка "Продавцы" не найдена');
            return [];
        }

        // Кликаем на кнопку "Продавцы"
        await page.evaluate(() => {
            const buttons = document.querySelectorAll('.chip-filter');
            for (const button of buttons) {
                const textElement = button.querySelector('.chip-filter__text');
                if (textElement && textElement.innerText.trim() === 'Продавцы') {
                    button.click();
                    break;
                }
            }
        });

        console.log('✅ Кнопка "Продавцы" нажата');
        
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Ждем появления списка продавцов
        try {
            await page.waitForSelector('.filter-list-submenu__item', { timeout: 10000 });
            console.log('✅ Список продавцов загружен');
        } catch (waitError) {
            console.log('⚠️ Список продавцов не загрузился');
            return [];
        }

        // Скроллим и загружаем всех продавцов
        const totalSellers = await scrollAndLoadAllSellers(page);

        console.log(`👥 Найдено ${totalSellers} продавцов`);

        if (totalSellers === 0) {
            console.log('⚠️ Продавцы не найдены');
            return [];
        }

        // Обрабатываем всех продавцов батчами
        const merchantIds = await processAllSellersBatches(page, totalSellers, categoryName);

        return merchantIds;

    } catch (error) {
        console.error(`❌ Ошибка при обработке страницы с товарами для категории "${categoryName}":`, error.message);
        return [];
    }
}

// Рекурсивная функция для обработки категории и всех её подкатегорий
async function processCategoryRecursively(page, categoryUrl, categoryName, depth = 0) {
    const maxDepth = 5; // Максимальная глубина рекурсии для предотвращения бесконечных циклов
    const indent = '  '.repeat(depth);
    
    console.log(`${indent}🔍 Обрабатываем категорию (глубина ${depth}): ${categoryName}`);
    console.log(`${indent}🔗 URL: ${categoryUrl}`);

    if (depth > maxDepth) {
        console.log(`${indent}⚠️ Достигнута максимальная глубина рекурсии (${maxDepth}), пропускаем`);
        return [];
    }

    try {
        await page.goto(categoryUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Проверяем, есть ли подкатегории на странице
        const subcategories = await getSubcategories(page);
        
        if (subcategories.length > 0) {
            console.log(`${indent}📋 Найдено ${subcategories.length} подкатегорий, обрабатываем рекурсивно...`);
            
            let allMerchantIds = [];
            
            // Рекурсивно обрабатываем каждую подкатегорию
            for (let i = 0; i < subcategories.length; i++) {
                const subcategory = subcategories[i];
                const subcategoryName = `${categoryName} > ${subcategory.text}`;
                const subcategoryUrl = `https://kaspi.kz${subcategory.href}`;
                
                console.log(`${indent}🔄 Подкатегория ${i + 1}/${subcategories.length}: ${subcategory.text}`);
                
                // Рекурсивный вызов для обработки подкатегории
                const subcategoryIds = await processCategoryRecursively(
                    page, 
                    subcategoryUrl, 
                    subcategoryName, 
                    depth + 1
                );
                
                allMerchantIds.push(...subcategoryIds);
                
                // Пауза между обработкой подкатегорий
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            console.log(`${indent}✅ Категория "${categoryName}" обработана. Найдено ${allMerchantIds.length} ID из подкатегорий`);
            return allMerchantIds;
            
        } else {
            // Если подкатегорий нет, проверяем, есть ли товары и продавцы
            console.log(`${indent}🛍️ Подкатегории не найдены, проверяем наличие товаров...`);
            
            // Проверяем, что мы на странице с товарами (ищем фильтры)
            const hasFilters = await page.evaluate(() => {
                return document.querySelectorAll('.chip-filter').length > 0;
            });

            if (hasFilters) {
                console.log(`${indent}✅ Найдены фильтры товаров, обрабатываем продавцов...`);
                const merchantIds = await processProductPage(page, categoryName);
                console.log(`${indent}💾 Категория "${categoryName}" обработана. Найдено ${merchantIds.length} merchant IDs`);
                return merchantIds;
            } else {
                console.log(`${indent}⚠️ Фильтры не найдены, возможно это не страница с товарами`);
                return [];
            }
        }

    } catch (error) {
        console.error(`${indent}❌ Ошибка при обработке категории "${categoryName}":`, error.message);
        return [];
    }
}

// Обновленная основная функция парсинга
async function parseMerchantIds() {
    console.log('🚀 Запуск рекурсивного парсера merchant ID v2...');

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
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
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

    // Отключение ненужных ресурсов
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (['image', 'font', 'media'].includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    let totalMerchantIds = 0;

    try {
        // Переходим на главную страницу
        console.log('🔍 Переходим на https://kaspi.kz/shop/almaty/');
        await page.goto('https://kaspi.kz/shop/almaty/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await new Promise(resolve => setTimeout(resolve, 3000));

        // Получаем все навигационные ссылки (пропускаем первые 3)
        const navLinks = await page.evaluate(() => {
            const links = document.querySelectorAll('.nav__item-link');
            const result = [];
            
            for (let i = 3; i < links.length; i++) {
                const link = links[i];
                const text = link.innerText.trim();
                let href = link.getAttribute('href');
                
                // Убираем домен если он есть, оставляем только путь
                if (href && href.startsWith('https://kaspi.kz')) {
                    href = href.replace('https://kaspi.kz', '');
                }
                
                if (text && href) {
                    result.push({ text, href });
                }
            }
            
            return result;
        });

        console.log(`📋 Найдено ${navLinks.length} основных категорий для обработки`);

        // Рекурсивно обрабатываем каждую основную категорию
        for (let i = 0; i < navLinks.length; i++) {
            const navLink = navLinks[i];
            console.log(`\n🏷️ === ОСНОВНАЯ КАТЕГОРИЯ ${i + 1}/${navLinks.length}: ${navLink.text} ===`);

            const categoryUrl = `https://kaspi.kz${navLink.href}`;
            
            // Рекурсивная обработка категории
            const categoryMerchantIds = await processCategoryRecursively(
                page, 
                categoryUrl, 
                navLink.text, 
                0 // Начальная глубина
            );

            totalMerchantIds += categoryMerchantIds.length;
            console.log(`🎯 Основная категория "${navLink.text}" завершена. Найдено ${categoryMerchantIds.length} merchant IDs`);
            console.log(`📊 Общий прогресс: ${totalMerchantIds} merchant IDs`);

            // Пауза между основными категориями
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log(`\n🎉 Парсинг завершен! Всего найдено ${totalMerchantIds} merchant IDs`);

    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    } finally {
        await browser.close();
    }
}

parseMerchantIds();