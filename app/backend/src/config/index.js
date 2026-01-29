import dotenv from 'dotenv';
dotenv.config({ override: true });

export const config = {
  port: parseInt(process.env.PORT || '4001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3998'],
  jwtSecret: process.env.JWT_SECRET || 'default-jwt-secret',
  supabase: {
    url: process.env.SUPABASE_URL,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    secretKey: process.env.SUPABASE_SECRET_KEY,
  },
  mathpix: {
    appId: process.env.MATHPIX_APP_ID,
    appKey: process.env.MATHPIX_APP_KEY,
  },
  llamaParse: {
    apiKey: process.env.LLAMAPARSE_API_KEY,
    apiUrl: 'https://api.cloud.llamaindex.ai/api/parsing',
  },
  imap: {
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.IMAP_PORT || '993', 10),
    tls: process.env.IMAP_TLS !== 'false',
    user: process.env.EMAIL_ADDRESS,
    password: process.env.EMAIL_PASSWORD,
    keepalive: process.env.IMAP_KEEPALIVE !== 'false',
    authTimeout: parseInt(process.env.IMAP_AUTH_TIMEOUT || '30000', 10),
    connTimeout: parseInt(process.env.IMAP_CONN_TIMEOUT || '30000', 10),
  },
  googleDrive: {
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    rootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
  },
  mongodb: {
    uri: process.env.MONGODB_URI,
  },
  gemini: {
    apiKey: process.env.GOOGLE_API_KEY,
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: 'gemini-2.0-flash',
  },
};

export default config;
