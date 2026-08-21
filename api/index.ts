/**
 * Punto de entrada de la API como función serverless en Vercel.
 *
 * Vercel enruta aquí todo lo que empieza con /api. La misma aplicación de
 * Express se usa en local (apps/api/src/server.ts) y en el despliegue.
 */

import { createApp } from "../apps/api/src/app.js";

export default createApp();
