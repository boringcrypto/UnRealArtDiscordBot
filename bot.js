import env from "./token.js"
import puppeteer from "puppeteer"
import http from "http"
import fs from "fs"

class Request {
    constructor(prompt) {
        this.start_time = 0
        this.prev_img_src
        this.prompt = prompt
        this.percentage = 0
        this.job_id = ""
        this.img_src = ""
        this.request_number = Math.floor(Math.random() * 1000000000).toString()

        this.status = "Waiting"

        this.author = ""
        this.title = ""
        this.description = ""
        this.publish_time = null
        this.error = ""
        request_map[this.request_number] = this
    }
}

let browser
let page
let current_request
let upscale_buttons = {}
let published = []
try {
    published = JSON.parse(fs.readFileSync('published.json'))
} catch (e) {
    console.log(e)
}
let requests = []
let request_map = {}
for (let i in published) {
    request_map[published[i].request_number] = published[i]
}

function save() {
    fs.writeFileSync('published_backup.json', JSON.stringify(published));
    fs.writeFileSync('published.json', JSON.stringify(published));
}

async function login() {
    console.log("Logging in")
    await page.waitForSelector('[name="email"]');
    await page.evaluate(() => document.querySelector('[name="email"]').value = "");
    await page.focus('[name="email"]');
    await page.keyboard.type(env.user, {
        delay: 10
    });
    await page.waitForSelector('[type="password"]');
    await page.evaluate(() => document.querySelector('[type="password"]').value = "");
    await page.focus('[type="password"]')
    await page.keyboard.type(env.pass, {
        delay: 10
    });
    await Promise.all([
        page.keyboard.press('Enter'),
        page.waitForNavigation()
    ]);
    if (page.url() !== "https://discord.com/login") {
        console.log("Login success")
        return true
    } else {
        console.log("Login fail")
        return false
    }
}

async function get_img_src() {
    try {
        //await page.waitForSelector("main ol li:last-of-type img[alt='Image']");
        const element = await page.$("main ol li:last-of-type img[alt='Image']")
        const img_src = await element.evaluate(node => node.src)

        return img_src            
    } catch {
        //console.log("Problem loading img_src")
        return ""
    }
}

async function init() {
    browser = await puppeteer.launch({
        headless: false
    });
    page = await browser.newPage();

    await page.goto('https://discordapp.com/app');

    while (page.url() === "https://discord.com/login" && !await login()) {
        page.waitForTimeout(10 * 60 * 1000) // Retry every 10 minutes
        await page.goto('https://discordapp.com/app');
    }

    // Go to Unreal server
    await page.waitForSelector(`div[data-dnd-name="UnRealArt's server"]`);
    await page.click(`div[data-dnd-name="UnRealArt's server"]`)

    // Wait a bit extra for messages to load
    await page.waitForTimeout(5000);

    await page.waitForSelector(`div[aria-label="Message #general"]`);

    // Set focus to the page (cursor is now focused on message input)
    await page.bringToFront()
}

async function send_imagine_command(prompt) {
    console.log("Running prompt", prompt)
    await page.keyboard.type("/imagine", {
        delay: 100
    });
    page.keyboard.press('Tab')
    await page.waitForTimeout(500)
    await page.keyboard.type(prompt, {
        delay: 10
    });
        
    page.keyboard.press('Enter')
}

let running = false
async function loop() {
    if (!running) {
        running = true
        await inner_loop()
        running = false
    }
}

async function upscale() {
    try {
        const button = await page.waitForSelector("main ol li:last-of-type button")
        await page.waitForTimeout(1000)
        if (button) {
            const button_text = await button.evaluate(node => node.innerText)
            if (button_text == "U1") {
                await button.click("main ol li:last-of-type button")
                console.log("Upscale button clicked")
                await page.waitForTimeout(3000)
            } else {
                current_request.status = "Error"
                current_request.error = "Something went wrong, please try again. (Wrong button)"
            }
        } else {
            current_request.status = "Error"
            current_request.error = "Something went wrong, please try again. (No button)"
        }
    } catch {
        current_request.status = "Error"
        current_request.error = "Something went wrong, please try again. (No button in page)"
    }
}

async function inner_loop() {
    if (current_request && current_request.start_time && Date.now() - current_request.start_time > (4 * 60 * 1000)) {
        // Request is taking too long
        current_request.error = "Timeout, something went wrong. Please try again."
        current_request.status = "Error"
        current_request = null
    }

    let img_src = await get_img_src()
    if (current_request && !img_src) {
        return
    }

    if (!current_request && requests.length) {
        current_request = requests.splice(0, 1)[0]
        current_request.prev_img_src = img_src
        current_request.start_time = Date.now()
        current_request.status = "Painting"
        await send_imagine_command(current_request.prompt)
    }

    if (current_request) {
        if (img_src != current_request.prev_img_src) {
            img_src = img_src.split("?")[0]

            if (img_src != current_request.img_src && current_request.img_src != img_src + "?width=400&height=267" ) {
                console.log(img_src)
                if (img_src.indexOf("_progress_image_") >= 0) {
                    const info = /.*\/([^/]*)_progress_image_([0-9]+).*/.exec(img_src)
                    current_request.img_src = img_src + "?width=400&height=267"
                    current_request.job_id = info[1]
                    current_request.percentage = info[2]
                    console.log("Job: ", current_request.job_id, " ", current_request.percentage, "%")
                } else {
                    if (current_request.status == "Painting") {
                        current_request.img_src = img_src
                        current_request.percentage = "100"
                        current_request.status = "Upscaling"
                        console.log("Done:", current_request.img_src)
    
                        await upscale()
                    } else if (current_request.status == "Upscaling") {
                        current_request.img_src = img_src
                        current_request.status = "Finished"
                        current_request.start_time = 0
                        console.log("Finished:", current_request.img_src)
                        current_request = null
                    } else {
                        console.log("Other")
                    }
                }
            } else if (current_request.status == "Upscaling") {
                await upscale()
            }
        }
    }
}

(async () => {
    await init()
    setInterval(loop, 250)
})();

const requestListener = function (req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET")

    if (req.url.startsWith("/request/")) {
        const prompt = decodeURI(req.url.substr(9))
        if (/^[ a-zA-Z0-9'"\-\:\,\|]*$/.test(prompt)) {
            const request = new Request(prompt)
            requests.push(request)
            res.writeHead(200);
            res.end(JSON.stringify(request));
        } else {
            res.writeHead(403);
            res.end("Bad prompt");
        }
    } else if (req.url.startsWith("/check/")) {
        const request_number = decodeURI(req.url.substr(7))
        res.writeHead(200);
        res.end(JSON.stringify({
            request: request_map[request_number],
            queue: requests.map(r => r.request_number).indexOf(request_number) + 1
        }));
    } else if (req.url.startsWith("/publish/")) {
        const params = req.url.substr(9).split("/")
        const request_number = decodeURI(params[0])
        const request = request_map[request_number]
        request.author = decodeURI(params[1])
        request.title = decodeURI(params[2])
        request.description = decodeURI(params[3])
        request.publish_time = Date.now()
        request.status = "Published"
        published.push(request)
        save()

        console.log("Published:", request.img_src)

        res.writeHead(200);
        res.end(JSON.stringify(request));
    } else if (req.url.startsWith("/show/")) {
        res.writeHead(200);
        if (published.length) {
            let shown = published[published.length - 1];
            if (Date.now() - (shown.publish_time || 0) > 120 * 1000) {
                shown = published[Math.floor(Date.now() / (20 * 1000)) % published.length];
            }
            res.end(JSON.stringify({
                image: shown,
                count: published.length
            }));
        } else {
            res.end("");
        }
    } else {
        res.writeHead(200);
        res.end(JSON.stringify(request_map));
    }
}
  
const server = http.createServer(requestListener);
server.listen(12345);