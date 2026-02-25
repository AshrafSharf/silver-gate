import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { supabase } from '../config/database.js';

// Authenticate JWT token
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwtSecret);

    // Handle hardcoded admin user (doesn't exist in database)
    if (decoded.userId === 'admin') {
      req.user = {
        id: 'admin',
        email: 'admin@localhost',
        name: 'Admin',
        role: 'admin',
      };
      return next();
    }

    // Fetch regular user from database
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

// Optional authentication (doesn't fail if no token)
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwtSecret);

    // Handle hardcoded admin user (doesn't exist in database)
    if (decoded.userId === 'admin') {
      req.user = {
        id: 'admin',
        email: 'admin@localhost',
        name: 'Admin',
        role: 'admin',
      };
      return next();
    }

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    if (user) {
      req.user = user;
    }
    next();
  } catch (error) {
    next();
  }
};

export default { authenticate, optionalAuth };
