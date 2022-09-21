import env from "./token.js"
import puppeteer from "puppeteer"
import http from "http"

class Request {
    constructor(prompt) {
        this.prev_img_src
        this.prompt = prompt
        this.percentage = 0
        this.job_id = ""
        this.img_src = ""
        this.request_number = Math.floor(Math.random() * 1000000000).toString()
        this.done = false
        this.accepted = null
        this.published = false
        this.author = ""
        this.title = ""
        this.description = ""
        request_map[this.request_number] = this
    }
}

let browser
let page
let current_request
let requests = [
    //new Request("vampire, colorful dragons, bats, victoria secret, detailed symmetrical face, photorealism, 8k --testp --creative --ar 3:2"),
    //new Request("portrait of pretty fairy, colorful jellyfish, butterflies, victoria secret, detailed symmetrical face, photorealism, 8k --testp --creative --ar 3:2")
]
let request_map = {}
let upscale_buttons = {}
let published = [{
    prompt: 'fairy with wings, victoria secret, colorful little dragons, bats, intricate tattoos, detailed symmetrical face, photorealism, 8k --testp --creative --ar 3:2 --upbeta',  
    percentage: '100',
    job_id: '8f1df69b-ffbf-4bd2-a092-ba685cf1196c',
    img_src: 'https://media.discordapp.net/ephemeral-attachments/1021424638829531198/1022140830569476116/UnRealArt_fairy_with_wings_victoria_secret_colorful_little_drag_8f1df69b-ffbf-4bd2-a092-ba685cf1196c.png',
    request_number: '629655321',
    done: true,
    accepted: true,
    published: true,
    author: 'Bart Jellema',
    title: 'Fairy',
    description: 'Desc',
    prev_img_src: 'https://media.discordapp.net/ephemeral-attachments/1021424638829531198/1022140354381758535/UnRealArt_fairy_with_wings_victoria_secret_colorful_little_drag_335dc5d5-cc66-4bfc-a8e5-22be318ea081.png?width=400&height=267'
}]

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

async function inner_loop() {
    const img_src = await get_img_src()
    if (current_request && !img_src) {
        console.log("No img src")
        return
    }

    if (!current_request && requests.length) {
        current_request = requests.splice(0, 1)[0]
        current_request.prev_img_src = img_src

        if (!current_request.done) {
            await send_imagine_command(current_request.prompt)
        } else {
            upscale_buttons[current_request.request_number].click()
        }
    }

    if (current_request) {
        if (img_src != current_request.prev_img_src) {
            if (img_src != current_request.img_src) {
                current_request.img_src = img_src
                if (img_src.indexOf("_progress_image_") >= 0) {
                    const info = /.*\/([^/]*)_progress_image_([0-9]+).*/.exec(img_src)
                    current_request.job_id = info[1]
                    current_request.percentage = info[2]
                    console.log("Job: ", current_request.job_id, " ", current_request.percentage, "%")
                } else {
                    current_request.img_src = current_request.img_src.split("?")[0]

                    if (!current_request.accepted) {
                        current_request.percentage = "100"
                        current_request.done = true
                        console.log("Done:", current_request.img_src)
    
                        const button = await page.$("main ol li:last-of-type button")
                        if (button) {
                            const button_text = await button.evaluate(node => node.innerText)
                            if (button_text == "U1") {
                                upscale_buttons[current_request.request_number] = button
                            }    
                        }    
                    } else {
                        current_request.published = true
                        published.push(current_request)

                        console.log("Published:", current_request.img_src)
                    }
            
                    current_request = null
                }
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
        if (/^[ a-zA-Z0-9\-\:\,\|]*$/.test(prompt)) {
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
        res.end(JSON.stringify(request_map[request_number]));
    } else if (req.url.startsWith("/upscale/")) {
        const params = req.url.substr(9).split("/")
        const request_number = decodeURI(params[0])
        request_map[request_number].author = decodeURI(params[1])
        request_map[request_number].title = decodeURI(params[2])
        request_map[request_number].description = decodeURI(params[3])
        if (upscale_buttons[request_number]) {
            request_map[request_number].accepted = true
            requests.push(request_map[request_number])
        }
        res.writeHead(200);
        res.end(JSON.stringify(request_map[request_number]));
    } else if (req.url.startsWith("/show/")) {
        res.writeHead(200);
        if (published.length) {
            res.end(JSON.stringify(published[published.length - 1]));
        } else {
            res.end("");
        }
    } else {
        res.writeHead(200);
        res.end(JSON.stringify(request_map));
    }
}
  
const server = http.createServer(requestListener);
server.listen(1234);