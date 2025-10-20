const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const RSS = require('rss');
const express = require('express');

const app = express();
const PORT = 3000;

const BASE_URL = 'https://pivigames.blog';
const MAX_PAGES = 3;

async function scrapePage(pageNumber) {
    const url = pageNumber === 1 ? BASE_URL + '/' : `${BASE_URL}/page/${pageNumber}`;
    console.log(`🔍 Scrapeando página ${pageNumber}: ${url}`);

    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
            },
        });

        const $ = cheerio.load(data);
        const articles = [];

        $('.gp-post-item').each((_, el) => {
            const title = $(el).find('.gp-loop-title a').text().trim();
            const link = $(el).find('.gp-loop-title a').attr('href');
            const img = $(el).find('img').attr('src');

            if (title && link) {
                articles.push({ title, link, img });
            }
        });

        console.log(`✅ Página ${pageNumber} scrapeada con ${articles.length} artículos`);
        return articles;
    } catch (err) {
        console.error(`❌ Error scraping página ${pageNumber}:`, err.message);
        return [];
    }
}

// intenta obtener la descripción desde la página del juego
async function fetchDescription(url) {
    try {
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 10000,
        });
        const $ = cheerio.load(data);

        // Intentos comunes: og:description, meta description, primer párrafo del contenido
        let desc = $('meta[property="og:description"]').attr('content')
            || $('meta[name="description"]').attr('content')
            || $('.entry-content p').first().text()
            || $('.gp-post-content p').first().text()
            || $('article p').first().text()
            || '';

        desc = (desc || '').trim().replace(/\s+/g, ' ');
        if (desc.length > 800) desc = desc.slice(0, 800) + '…';
        return desc;
    } catch (err) {
        console.warn(`⚠️ No se pudo obtener descripción de ${url}: ${err.message}`);
        return '';
    }
}

function removeDuplicatesByUrl(articles) {
    const seen = new Set();
    return articles.filter(article => {
        if (seen.has(article.link)) {
            return false;
        } else {
            seen.add(article.link);
            return true;
        }
    });
}

async function scrapeAllPages() {
    let allArticles = [];
    for (let i = 1; i <= MAX_PAGES; i++) {
        const articles = await scrapePage(i);
        if (articles.length === 0) {
            console.log('🚫 No más artículos encontrados, paro scraping.');
            break;
        }
        allArticles = allArticles.concat(articles);
    }

    // Filtramos duplicados aquí
    const uniqueArticles = removeDuplicatesByUrl(allArticles);
    console.log(`🔝 Total artículos únicos scrapeados: ${uniqueArticles.length}`);
    // Obtener descripción para cada artículo (secuencial para evitar sobrecarga)
    for (const article of uniqueArticles) {
        article.description = await fetchDescription(article.link);
        if (!article.description && article.img) {
            article.description = `<img src="${article.img}" alt="${article.title}" /><p><a href="${article.link}">${article.title}</a></p>`;
        }
    }

    return uniqueArticles;
}

function generateRSS(posts) {
    const feed = new RSS({
        title: 'Pivigames - Últimos juegos',
        description: 'Juegos gratis publicados en Pivigames.blog',
        feed_url: `${BASE_URL}/rss.xml`,
        site_url: BASE_URL,
        language: 'es',
        ttl: 60,
    });

    posts.forEach(post => {
        const shortDesc = post.description
            ? post.description
            : (post.img ? `<img src="${post.img}" alt="${post.title}" /><p><a href="${post.link}">${post.title}</a></p>` : `<p><a href="${post.link}">${post.title}</a></p>`);

        feed.item({
            title: post.title,
            url: post.link,
            date: new Date(),
            description: shortDesc,
            enclosure: post.img ? { url: post.img } : undefined,
        });
    });

    return feed.xml({ indent: true });
}

app.get('/rss.xml', async (req, res) => {
    try {
        const posts = await scrapeAllPages();
        if (!posts.length) {
            return res.status(404).send('No se encontraron artículos para generar RSS');
        }

        const xml = generateRSS(posts);

        const filePath = path.resolve(__dirname, 'pivigames.xml');
        try {
            fs.writeFileSync(filePath, xml, { encoding: 'utf-8' });
            console.log(`✅ Archivo RSS guardado localmente en: ${filePath}`);
        } catch (writeErr) {
            console.error('❌ Error guardando archivo RSS localmente:', writeErr);
        }

        res.type('application/rss+xml');
        res.send(xml);
    } catch (error) {
        console.error('❌ Error generando RSS:', error);
        res.status(500).send('Error generando RSS');
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor Express escuchando en http://localhost:${PORT}/rss.xml`);
});
