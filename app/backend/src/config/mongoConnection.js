import mongoose from 'mongoose';
import { config } from './index.js';
import logger from '../utils/logger.js';

let isConnected = false;

export async function connectToMongoDB() {
  if (isConnected) {
    logger.info('MONGO', 'Already connected to MongoDB');
    return;
  }

  if (!config.mongodb.uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  try {
    await mongoose.connect(config.mongodb.uri);
    isConnected = true;
    logger.success('MONGO', 'Connected to MongoDB');
  } catch (error) {
    logger.error('MONGO', `Failed to connect to MongoDB: ${error.message}`);
    throw error;
  }
}

export async function disconnectFromMongoDB() {
  if (!isConnected) {
    return;
  }

  try {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('MONGO', 'Disconnected from MongoDB');
  } catch (error) {
    logger.error('MONGO', `Failed to disconnect from MongoDB: ${error.message}`);
    throw error;
  }
}

export function getMongoConnection() {
  return mongoose.connection;
}
