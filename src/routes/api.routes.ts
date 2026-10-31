import { Router } from "express";
import { handleWhatsAppWebhook } from "../controllers/webhook.controller.js";

export const apiRouter = Router();

apiRouter.post("/webhooks/whatsapp", handleWhatsAppWebhook);
