/**
 * Simple Console Logger
 * Provides consistent, colorful console output without file writes
 */

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

// Log level colors
const levelColors = {
  info: colors.cyan,
  success: colors.green,
  warn: colors.yellow,
  error: colors.red,
  debug: colors.gray,
};

// Module/tag colors for visual distinction
const tagColors = {
  SERVER: colors.green,
  EMAIL: colors.magenta,
  DB: colors.blue,
  API: colors.cyan,
  AUTH: colors.yellow,
  JOB: colors.blue,
  MATHPIX: colors.magenta,
  SCAN: colors.cyan,
  MONGO: colors.green,
  SYNC: colors.blue,
  REVERSE_SYNC: colors.magenta,
  LESSON_SYNC: colors.cyan,
  LESSON_ITEM_SYNC: colors.cyan,
};

function getTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { hour12: false });
}

function formatTag(tag) {
  const color = tagColors[tag] || colors.white;
  return `${color}[${tag}]${colors.reset}`;
}

function formatLevel(level) {
  const color = levelColors[level] || colors.white;
  const label = level.toUpperCase().padEnd(5);
  return `${color}${label}${colors.reset}`;
}

function formatMessage(level, tag, message, ...args) {
  const timestamp = `${colors.gray}${getTimestamp()}${colors.reset}`;
  const formattedTag = formatTag(tag);
  const formattedLevel = formatLevel(level);

  return `${timestamp} ${formattedLevel} ${formattedTag} ${message}`;
}

export const logger = {
  info(tag, message, ...args) {
    console.log(formatMessage('info', tag, message), ...args);
  },

  success(tag, message, ...args) {
    console.log(formatMessage('success', tag, message), ...args);
  },

  warn(tag, message, ...args) {
    console.warn(formatMessage('warn', tag, message), ...args);
  },

  error(tag, message, ...args) {
    console.error(formatMessage('error', tag, message), ...args);
  },

  debug(tag, message, ...args) {
    if (process.env.NODE_ENV === 'development') {
      console.log(formatMessage('debug', tag, message), ...args);
    }
  },

  // Convenience method for server startup banner
  banner(appName, port, env) {
    const line = '═'.repeat(50);
    console.log(`\n${colors.cyan}${line}${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}  ${appName}${colors.reset}`);
    console.log(`${colors.cyan}${line}${colors.reset}`);
    console.log(`  ${colors.gray}Port:${colors.reset}        ${colors.green}${port}${colors.reset}`);
    console.log(`  ${colors.gray}Environment:${colors.reset} ${colors.yellow}${env}${colors.reset}`);
    console.log(`${colors.cyan}${line}${colors.reset}\n`);
  },

  // Request logging (for custom middleware)
  request(method, path, status, duration) {
    const methodColors = {
      GET: colors.green,
      POST: colors.blue,
      PUT: colors.yellow,
      DELETE: colors.red,
      PATCH: colors.magenta,
    };

    const methodColor = methodColors[method] || colors.white;
    const statusColor = status >= 400 ? colors.red : status >= 300 ? colors.yellow : colors.green;

    const timestamp = `${colors.gray}${getTimestamp()}${colors.reset}`;
    const formattedMethod = `${methodColor}${method.padEnd(6)}${colors.reset}`;
    const formattedStatus = `${statusColor}${status}${colors.reset}`;
    const formattedDuration = `${colors.gray}${duration}ms${colors.reset}`;

    console.log(`${timestamp} ${formattedMethod} ${path} ${formattedStatus} ${formattedDuration}`);
  },
};

export default logger;
