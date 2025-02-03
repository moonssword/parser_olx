const pool = require('./pg_config'); // Подключаем конфигурацию PostgreSQL
require('dotenv').config();

// Функция для сохранения данных объявления в базу данных
async function saveAdToDatabase(adData) {
    const {
        adId, adUrl, title, address, price, location, floor, area, condition,
        phone, author, description, furniture, facilities, toilet,
        bathroom, suitableFor, rooms, postedAt, photos, promotions
    } = adData;

    const query = `
        INSERT INTO ads (
            ad_id, ad_url, title, address, price, rooms, location, floor_current, floor_total,
            area, condition, phone, author, description, furniture,
            facilities, toilet, bathroom, suitable_for, posted_at, photos, promotions
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
        )
        ON CONFLICT (ad_id) DO NOTHING;
    `;

    const jsonPhotos = Array.isArray(photos) ? JSON.stringify(photos) : '[]';
    const jsonPromotions = Array.isArray(promotions) ? JSON.stringify(promotions) : '[]';

    // Подготовка значений для вставки
    const values = [
        adId, adUrl, title, address, price, rooms, location, floor?.current, floor?.total, area, condition,
        phone, author, description, furniture, facilities, toilet, bathroom, suitableFor, postedAt, jsonPhotos || [], jsonPromotions
    ];

    try {
        await pool.query(query, values);
        console.log(`Объявление с ID ${adId} успешно сохранено.`);
    } catch (err) {
        console.error('Ошибка при сохранении объявления в базу данных:', err);
        throw err;
    }
}

module.exports = { saveAdToDatabase };
