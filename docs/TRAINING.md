# How to Train Your Chatbot — A Guide for Owners

This is a plain-language guide, **for the business owner**, on how to teach
your FlowChat assistant everything it needs to answer customer questions. You
don't need to know what "embeddings" or "RAG" are — just follow along.

> **The simple rule:** the more you tell your bot, the better it can answer.
> Everything you add — your voice, a PDF, a photo, a FAQ list — becomes the
> bot's "brain." Customers get answers *only* from what you gave it.

---

## 1. Speak It (Voice Mode)

This is the fastest way to get started.

1. Go to your bot's **Knowledge** tab in the dashboard.
2. Press the **🎤 mic button**.
3. Say something like:
   > "I run Sharma's General Store in Sector 12. We sell groceries, snacks, and
   > fresh vegetables. We open at 8 AM and close at 9 PM. Sundays we close at
   > 2 PM. We don't deliver, but customers can call the store directly."
4. Press **Stop** when you're done.

Your voice is turned into text by your browser (no audio is stored or sent to
anyone but your own device for transcription), and that text is fed into your
bot's knowledge base exactly like a typed note. You can record multiple voice
notes — each one adds more.

## 2. Upload a File

Upload a single document that already describes your business.

- **Supported:** `.pdf`, `.docx`, `.md`, `.csv`, `.json`, `.txt`
- Click **Upload file**, pick the file, and select the bot.
- We read the text and add it to your bot's brain.

**Example:** upload your monthly price list, your cancellation policy, or your
menu.

## 3. Show Us a Photo (Vision Mode)

Have a price board, menu, or product label on paper? Take a photo and upload it.

- **Supported image types:** `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`
- We don't just store the picture — we ask the AI to *read* it and turn it into
  searchable text. So a photo of today's "Onion: ₹30/kg" board becomes
  something the bot can answer "What's the price of onions today?".

**Tip:** good lighting and flat photos work best.

## 4. Add Your Website

If you already have a website, catalogue, or WhatsApp link, paste it.

1. In the **Knowledge** tab, click **Add website**.
2. Paste the full URL (e.g. `https://sharma-store.in/menu`).
3. Click **Scrape**. We fetch the page and read its text into your bot.

## 5. Teach It FAQs (Question & Answer)

Tell your bot the 5–10 things customers ask most, with your own answers.

1. In the **Knowledge** tab, open the **"Add Q&A"** section.
2. Type (or speak) pairs like:
   - Q: *What are your opening hours?* → A: *8 AM to 9 PM, closed on Sundays after 2 PM.*
   - Q: *Do you accept cards?* → A: *Yes, we accept all major cards and UPI.*
3. Save. Done.

We also have a **"Suggest Questions"** button: give us your shop name and a
short description, and we'll propose likely customer questions you can fill in.

## 6. Give It a Personality (System Prompt)

Your bot should sound like *your* business, not a robot.

1. Go to the bot's **Settings** tab.
2. In the **System Prompt** box, write something like:
   > "You are a friendly shop assistant at Sharma's General Store. Answer in
   > short, helpful Hindi-English (Hinglish). Always smile in your tone."
3. Save.

This is the first thing the AI sees on every chat, so it shapes *how* the bot
answers. It's optional — if you leave it blank, we use a sensible default that
names your shop.

---

## What Happens to What You Give It?

Every training item goes through the same pipeline:

```
Your input (voice text / file text / image → vision text / website text / Q&A)
  → split into small chunks
  → turned into numbers (vectors) the AI can compare
  → stored *only* under your bot's name (bot_id)
  → searched every time someone asks your bot a question
```

Because your data is tagged to **your bot only**, another business's chatbot
can never see your prices, your policies, or your photos. Your knowledge stays
*your* knowledge.

## Tips for Better Answers

- **Be specific.** "We open 8 AM to 9 PM" beats "We're open daily."
- **Update often.** Prices change — re-upload the latest price board photo and
  the bot immediately uses the new numbers.
- **Cover the FAQs.** If customers ask it, add it as a Q&A. The bot will start
  answering confidently.
- **Check the sources.** When the bot answers, the chat shows which training
  material it used — so you (and your customers) can trust the answer.

## When You're Done Training

1. Go to your bot's dashboard. You'll see your **Shareable Link**
   (`chat.flowchat.app/your-store`).
2. Send that link to your customers on WhatsApp, put it on your shop poster, or
   add it to your Instagram bio.
3. Customers open the link, type or speak their question, and get an answer
   drawn only from what you taught the bot.

No login needed for your customers. No credit card. Just your link, your way.
