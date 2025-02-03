const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const fsExtra = require('fs-extra');
const DB = require('./db-manager');
const moment = require('moment');
const path = require('path');
const https = require('https');
require('dotenv').config();

const logFileName = `log_${moment().format('YYYY-MM-DD_HH-mm-ss')}.txt`;
const logDir = path.join(__dirname, 'logs');
const logFilePath = path.join(logDir, logFileName);

// Функция для записи в файл логов
fsExtra.ensureDirSync(logDir);
function logToFile(message) {
    fs.appendFileSync(logFilePath, `${moment().format('YYYY-MM-DD HH:mm:ss')} - ${message}\n`);
}

// Настраиваем axios с таймаутом
const instance = axios.create({
    timeout: 5000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
    }
});

// Чтение конфигурационного файла
const config = require('./searchConfig.json');

// Функция для загрузки страницы с повторными попытками
async function fetchPageWithRetry(url, retries = 3, delay = 3000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await instance.get(url);
            return response.data;
        } catch (error) {
            if (i === retries - 1) {
                console.error(`Не удалось загрузить страницу: ${url} после ${retries} попыток`);
                return null;
            }
            console.log(`Повторная попытка загрузки страницы: ${url} через ${delay / 1000} секунд`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Функция для подсчета общего количества объявлений
function parseTotalAds(html) {
    const $ = cheerio.load(html);
    
    // Ищем элемент по атрибуту data-testid="total-count"
    const totalText = $('span[data-testid="total-count"]').text();

    // Извлекаем число из текста
    const match = totalText.match(/(\d+)/);
    
    // Возвращаем число или 0, если число не найдено
    return match ? parseInt(match[1].replace(/\s+/g, ''), 10) : 0;
}

// Функция для получения массива ID объявлений на странице
async function parseAdIds(html) {
    const $ = cheerio.load(html);
    const adIds = [];

    $('div[data-cy="l-card"]').each((i, elem) => {
        const adId = $(elem).attr('id');
        if (adId) {
            adIds.push(adId);
        }
    });

    return adIds;
}

// Функция для сборки URL поиска с учетом параметров
function buildSearchUrl(config, page, city) {
    const baseUrl = `${config.base_url}${config.params.type}/${config.params.space}/${city}/`;
    const params = [];

    if (config.params.has_photos) {
        params.push('search%5Bphotos%5D=1');
    }

    if (config.params.from_owner) {
        params.push('search%5Bfilter_enum_tipsobstvennosti%5D%5B0%5D=ot_hozyaina');
    }

    if (config.params.rooms && config.params.rooms.length > 0) {
        config.params.rooms.forEach((room, index) => {
            params.push(`search%5Bfilter_enum_kolichestvokomnat%5D%5B${index}%5D=${room}`);
        });
    }

    if (page && page > 1) {
        params.push(`page=${page}`);
    }

    // Объединяем базовый URL и параметры
    return `${baseUrl}?${params.join('&')}`;
}

// Функция для извлечения деталей объявления через API
async function parseAdDetails(adId) {
    try {

        if (adId && await DB.checkAdExists(adId)) {
            console.log(`Объявление с ID ${adId} уже существует в базе данных.`);
            return null;
        }

        // Извлечение номера телефона
        let phoneNumber = await getPhoneNumberFromAPI(adId);
        if (!phoneNumber) return null;

        const adApiUrl = `${config.base_url}api/v1/offers/${adId}/`;

        const response = await axios.get(adApiUrl);
        const adData = response.data.data;

        if (!adData) {
            console.warn(`Не удалось загрузить данные объявления с ID ${adId}`);
            return null;
        }

        const areaConverted = Math.round(parseFloat(adData.params.find(p => p.key === "obshayaploshad")?.value.key) || 0);

        const adDetails = {
            adId: adData.id,
            adUrl: adData.url,
            title: adData.title,
            description: adData.description.replace(/<\/?[^>]+(>|$)/g, '').trim(),
            duration: 'long_time',
            price: adData.params.find(p => p.key === "price")?.value.value || 0,
            city: adData.location.city.name,
            district: adData.location.district?.name.replace(' район', '') || null,
            rooms: parseInt((adData.params.find(p => p.key === "kolichestvokomnat")?.value.label.match(/\d+/) || [])[0], 10) || null,
            floor: {
                current: adData.params.find(p => p.key === "etazh")?.value.label || null,
                total: adData.params.find(p => p.key === "etazhnost_doma")?.value.label || null,
            },
            area: areaConverted,
            condition: adData.params.find(p => p.key === "remont")?.value.label || '',
            author: adData.params.find(p => p.key === "tipsobstvennosti")?.value.label === "от хозяина" ? 'owner' : 'agency',
            furniture: adData.params.find(p => p.key === "meblirovaniye")?.value.label === "Да" ? 'мебель' : 'без мебели',
            facilities: (adData.params.find(p => p.key === "tehnika")?.value.label || '').toLowerCase(),
            toilet: adData.params.find(p => p.key === "sanuzel")?.value.label === "совместный" ? 'совмещенный санузел' : 'раздельный санузел',
            converted_photos: adData.photos.map(photo => photo.link.replace(';s={width}x{height}', '.webp')),
            postedAt: moment(adData.last_refresh_time).format('YYYY-MM-DD'),
            phone: phoneNumber,
            houseType: config.params.space === 'arenda-kvartiry' ? 'apartment' : '',
            source: "parser_olx",
            adType: "rentOut",
        };

        return adDetails;
    } catch (error) {
        console.error(`Ошибка при загрузке данных объявления с ID ${adId}:`, error);
        return null;
    }
}

// Функция для сохранения данных в JSON
function saveDataToJson(data, filename) {
    try {
        fs.writeFileSync(filename, JSON.stringify(data, null, 2), 'utf8');
        console.log(`Данные сохранены в файл: ${filename}`);
    } catch (error) {
        console.error(`Ошибка при сохранении данных в файл: ${filename}`, error);
    }
}

// Главная функция для парсинга страниц и объявлений
async function scrapeAds() {
    const cities = config.params.cities;
    let adsData = [];

    for (const city of cities) {
        console.log(`Начинаем парсинг для города: ${city}`);
        let page = 1;
        let hasMorePages = true;
        let totalAdsPrinted = false;
        let adsCollected = 0;

        while (hasMorePages && adsCollected < config.max_ads_per_city) {
            const searchUrl = buildSearchUrl(config, page, city);
            console.log(`Парсинг страницы: ${searchUrl}`);
    
            const pageContent = await fetchPageWithRetry(searchUrl);
            if (!pageContent) {
                hasMorePages = false;
                break;
            }
    
            // Вывод общего количества объявлений при парсинге первой страницы
            if (!totalAdsPrinted) {
                const totalAds = parseTotalAds(pageContent); // Функция для извлечения общего количества
                console.log(`Общее количество объявлений: ${totalAds}`);
                totalAdsPrinted = true;
            }
    
            const adIds = await parseAdIds(pageContent);
            
            if (adIds.length === 0) {
                hasMorePages = false;
                break;
            }
    
            for (const adId of adIds) {
                console.log(`Парсинг объявления: ${adId}`);
    
                const adDetails = await parseAdDetails(adId);
    
                if (!adDetails) {
                    continue; // Переходим к следующему объявлению
                } else {
                    // Сохранение объявления в базу данных
                    try {
                        //saveDataToJson(adDetails, `test_${adDetails.adId}.json`)
                        await DB.saveAdToDatabase(adDetails);
                        adsData.push(adDetails); // Массив для дальнейшего использования (если нужно)
                        adsCollected++;
                    } catch (err) {
                        console.error(`Ошибка при сохранении объявления ${adId}:`, err);
                    }
    
                    if (adsCollected >= config.max_ads_per_city) {
                        hasMorePages = false;
                        break;
                    }
                }
    
                //const randomDelay = Math.floor(Math.random() * 2000) + 1000;
                await new Promise(resolve => setTimeout(resolve, 1000));  // Добавляем паузу между запросами
            }
            page++;
        }
    }
 

    console.log(`${adsData.length} объявлений успешно обработано и сохранено в базу данных.`);
}

scrapeAds();

// Функция для извлечения номера телефона через API
async function getPhoneNumberFromAPI(adId) {
    //await new Promise(resolve => setTimeout(resolve, 2000)); // Добавляем паузу между запросами

    const proxyConfig = {
        host: 'brd.superproxy.io',
        port: 33335,
        auth: {
            username: process.env.PROXY_USERNAME,
            password: process.env.PROXY_PSSWRD,
        },
    };

    const apiUrl = `${config.base_url}api/v1/offers/${adId}/limited-phones/`;

    try {
        const agent = new https.Agent({ rejectUnauthorized: false });

        const response = await axios.get(apiUrl, {
            proxy: proxyConfig,
            httpsAgent: agent,
            timeout: 10000,
        });

        if (response.data && response.data.data && response.data.data.phones) {
            const phones = response.data.data.phones;
            let firstPhone;

            if (Array.isArray(phones) && phones.length > 0) {
                firstPhone = phones[0].replace(/\s+/g, '');
            } else if (typeof phones === 'string') {
                firstPhone = phones.replace(/\s+/g, '');
            }

            if (firstPhone) {
                // Заменяем первую 8 на +7
                firstPhone = firstPhone.replace(/^8/, '+7').replace(/[()\-\s]/g, '');
                return firstPhone;
            }
        }

        console.log(`Не удалось извлечь номер телефона через API для объявления с ID: ${adId}`);
        return null;
    } catch (error) {
        console.error(`Ошибка при запросе телефона через API для объявления с ID: ${adId}`, error.message);
        return null;
    }
}