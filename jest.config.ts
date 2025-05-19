/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  globals: {
    'ts-jest': {
      tsconfig: './tsconfig.json',
    },
  },
  moduleNameMapper: {
    '@app/(.*)': '<rootDir>/src/$1',
  },
  preset: 'ts-jest',
  testEnvironment: 'node',
};
