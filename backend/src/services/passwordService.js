const bcrypt = require("bcrypt");

const BCRYPT_COST = 12;

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, BCRYPT_COST);
}

async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

module.exports = {
  BCRYPT_COST,
  hashPassword,
  verifyPassword,
};
