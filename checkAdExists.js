const pool = require('./pg_config_parser');
// Функция для проверки существования объявления в базе данных
async function checkAdExists(adId) {
    const query = 'SELECT 1 FROM ads WHERE ad_id = $1 LIMIT 1;';
    try {
        const result = await pool.query(query, [adId]);
        return result.rowCount > 0;
    } catch (err) {
        console.error('Ошибка при проверке существования объявления:', err);
        throw err;
    }
}

module.exports = { checkAdExists };