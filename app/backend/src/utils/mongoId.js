/**
 * Generate a MongoDB-compatible ObjectId (24-character hex string)
 * Structure: 4 bytes timestamp + 5 bytes random + 3 bytes counter
 */
let counter = Math.floor(Math.random() * 0xffffff);

export function generateMongoId() {
  const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const random = Array.from({ length: 5 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  ).join('');
  counter = (counter + 1) % 0xffffff;
  const count = counter.toString(16).padStart(6, '0');
  return timestamp + random + count;
}
