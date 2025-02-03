const pool = require('./pg_config');
require('dotenv').config();

// Функция для сохранения данных объявления в базу данных
async function saveAdToDatabase(adData) {
    const {
        adId, adUrl, title, rooms, price, city, district, duration, floor, area, condition,
        phone, author, description, furniture, facilities, toilet,
        converted_photos, postedAt, source, adType, houseType
    } = adData;

    const query = `
        INSERT INTO ads (
            ad_id, ad_url, title, rooms, price, city, district, duration, floor_current, floor_total,
            area, condition, phone, author, description, furniture,
            facilities, toilet, converted_photos, posted_at, source, ad_type, house_type
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
        )
        ON CONFLICT (ad_id) DO NOTHING;
    `;

    // Разделение этажности (current и total)
    const floorCurrent = floor?.current || null; // Текущий этаж
    const floorTotal = floor?.total || null; // Общее количество этажей

    // Преобразование массива фото в JSON
    const jsonPhotos = Array.isArray(converted_photos) ? JSON.stringify(converted_photos) : '[]';

    const values = [
        adId, adUrl, title, rooms, price, city, district, duration, floorCurrent, floorTotal,
        area, condition, phone, author, description, furniture,
        facilities, toilet, jsonPhotos, postedAt, source, adType, houseType
    ];

    try {
        await pool.query(query, values);
        console.log(`Объявление с ID ${adId} успешно сохранено.`);
    } catch (err) {
        console.error('Ошибка при сохранении объявления в базу данных:', err);
        throw err;
    }
}

// Функция для проверки существования объявления в базе данных
async function checkAdExists(adId) {
    const query = 'SELECT 1 FROM ads WHERE ad_id = $1 LIMIT 1;';
    try {
        const result = await pool.query(query, [adId]);
        return result.rowCount > 0;
    } catch (err) {
        console.error('Ошибка при проверке существования объявления:', err);
        throw err;
    } finally {
        //pool.end();
    }
}

module.exports = { saveAdToDatabase, checkAdExists };
