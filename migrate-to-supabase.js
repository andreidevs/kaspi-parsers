const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Настройки Supabase
const supabaseUrl = 'https://xnwacziuktpvayhoozlr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhud2Fjeml1a3RwdmF5aG9vemxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxNjUyODgsImV4cCI6MjA2Nzc0MTI4OH0.EJUJg4m3KD8f1KT8Hsz6uXB2PxdpftkhDdfzwYp6vzw';
const supabase = createClient(supabaseUrl, supabaseKey);

// Файлы для миграции
const VALID_IDS_FILE = 'valid_merchant_ids.txt';
const PROCESSED_IDS_FILE = 'processed_api_ids.txt';

async function migrateValidIds() {
    if (!fs.existsSync(VALID_IDS_FILE)) {
        console.log(`❌ Файл ${VALID_IDS_FILE} не найден`);
        return;
    }

    console.log(`📁 Читаем валидные ID из ${VALID_IDS_FILE}...`);
    
    const data = fs.readFileSync(VALID_IDS_FILE, 'utf-8');
    const lines = data.split('\n').filter(line => line.trim());
    
    console.log(`📊 Найдено ${lines.length} валидных ID`);

    const batchSize = 100;
    let migrated = 0;
    let errors = 0;

    for (let i = 0; i < lines.length; i += batchSize) {
        const batch = lines.slice(i, i + batchSize);
        const records = batch.map(line => {
            const id = line.trim();
            return {
                merchant_id: parseInt(id),
                data_length: 1, // Предполагаем что есть данные, так как ID валидный
                found_at: new Date().toISOString()
            };
        }).filter(record => !isNaN(record.merchant_id));

        try {
            const { error } = await supabase
                .from('generateid_valid')
                .insert(records);

            if (error) {
                console.error(`❌ Ошибка вставки batch ${i}-${i + batchSize}:`, error);
                errors += records.length;
            } else {
                migrated += records.length;
                console.log(`✅ Мигрировано ${migrated}/${lines.length} валидных ID`);
            }
        } catch (error) {
            console.error(`❌ Критическая ошибка batch ${i}-${i + batchSize}:`, error);
            errors += records.length;
        }

        // Пауза между батчами
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`📊 Миграция валидных ID завершена: ${migrated} успешно, ${errors} ошибок`);
}

async function migrateProcessedIds() {
    if (!fs.existsSync(PROCESSED_IDS_FILE)) {
        console.log(`❌ Файл ${PROCESSED_IDS_FILE} не найден`);
        return;
    }

    console.log(`📁 Читаем обработанные ID из ${PROCESSED_IDS_FILE}...`);
    
    const data = fs.readFileSync(PROCESSED_IDS_FILE, 'utf-8');
    const lines = data.split('\n').filter(line => line.trim());
    
    console.log(`📊 Найдено ${lines.length} обработанных ID`);

    const batchSize = 1000; // Увеличили с 100 до 1000
    const concurrentBatches = 5; // Параллельная обработка 5 батчей
    let migrated = 0;
    let errors = 0;

    // Разбиваем на батчи
    const batches = [];
    for (let i = 0; i < lines.length; i += batchSize) {
        batches.push(lines.slice(i, i + batchSize));
    }

    console.log(`📦 Создано ${batches.length} батчей по ${batchSize} записей`);

    // Функция для обработки одного батча
    async function processBatch(batch, batchIndex) {
        const records = batch.map(line => {
            const id = line.trim();
            return {
                merchant_id: parseInt(id),
                processed_at: new Date().toISOString()
            };
        }).filter(record => !isNaN(record.merchant_id));

        try {
            const { error } = await supabase
                .from('generateid_processed')
                .insert(records);

            if (error) {
                console.error(`❌ Ошибка вставки batch ${batchIndex + 1}/${batches.length}:`, error);
                return { success: false, count: records.length };
            } else {
                console.log(`✅ Batch ${batchIndex + 1}/${batches.length} - мигрировано ${records.length} записей`);
                return { success: true, count: records.length };
            }
        } catch (error) {
            console.error(`❌ Критическая ошибка batch ${batchIndex + 1}/${batches.length}:`, error);
            return { success: false, count: records.length };
        }
    }

    // Обрабатываем батчи параллельно
    for (let i = 0; i < batches.length; i += concurrentBatches) {
        const currentBatches = batches.slice(i, i + concurrentBatches);
        const promises = currentBatches.map((batch, index) => 
            processBatch(batch, i + index)
        );

        const results = await Promise.all(promises);
        
        results.forEach(result => {
            if (result.success) {
                migrated += result.count;
            } else {
                errors += result.count;
            }
        });

        console.log(`📈 Прогресс: ${migrated + errors}/${lines.length} (${Math.round((migrated + errors) / lines.length * 100)}%)`);
        
        // Небольшая пауза между группами батчей
        if (i + concurrentBatches < batches.length) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    console.log(`📊 Миграция обработанных ID завершена: ${migrated} успешно, ${errors} ошибок`);
}

async function checkTablesExist() {
    try {
        // Проверяем таблицу generateId_valid
        const { data: validData, error: validError } = await supabase
            .from('generateid_valid')
            .select('count')
            .limit(1);

        if (validError) {
            console.error('❌ Таблица generateId_valid не существует:', validError.message);
            return false;
        }

        // Проверяем таблицу generateId_processed
        const { data: processedData, error: processedError } = await supabase
            .from('generateid_processed')
            .select('count')
            .limit(1);

        if (processedError) {
            console.error('❌ Таблица generateId_processed не существует:', processedError.message);
            return false;
        }

        console.log('✅ Обе таблицы существуют');
        return true;
    } catch (error) {
        console.error('❌ Ошибка проверки таблиц:', error);
        return false;
    }
}

// Главная функция миграции
(async () => {
    console.log('🚀 Запуск миграции данных в Supabase...');
    
    // Проверяем существование таблиц
    const tablesExist = await checkTablesExist();
    if (!tablesExist) {
        console.log('❌ Создайте таблицы в Supabase SQL Editor перед миграцией');
        process.exit(1);
    }

    console.log('═'.repeat(60));
    
    // Мигрируем валидные ID
    await migrateValidIds();
    
    // console.log('═'.repeat(60));
    //
    // // Мигрируем обработанные ID
    // await migrateProcessedIds();
    
    console.log('═'.repeat(60));
    console.log('✅ Миграция завершена!');
    
    // Показываем статистику
    try {
        const { count: validCount } = await supabase
            .from('generateid_valid')
            .select('*', { count: 'exact', head: true });
            
        const { count: processedCount } = await supabase
            .from('generateid_processed')
            .select('*', { count: 'exact', head: true });
            
        console.log(`📊 Итоговая статистика:`);
        console.log(`   Валидных ID в базе: ${validCount || 0}`);
        console.log(`   Обработанных ID в базе: ${processedCount || 0}`);
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error);
    }
})();
