const cron = require('node-cron');
const parser = require('./parser');

console.log('Waiting start schedule...');

cron.schedule('0 15 * * *', async () => {
        try {
        console.log('Запуск парсинга объявлений');
        await parser.scrapeAds();
    } catch (error) {
        console.error('Ошибка во время парсинга или удаления водяных знаков:', error);
    }
});