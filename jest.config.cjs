/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  coverageReporters: ['cobertura', 'lcov', 'text'],
  coveragePathIgnorePatterns: ['<rootDir>/tests/*', '<rootDir>/node_modules/*'],
};
