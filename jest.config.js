/**
 * Jest Configuration for SNAC v2
 */

module.exports = {
  // Automatically clear mock calls and instances between every test
  clearMocks: true,

  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: true,

  // The directory where Jest should output its coverage files
  coverageDirectory: 'coverage',

  // An array of glob patterns indicating a set of files for which coverage information should be collected
  collectCoverageFrom: [
    'server.js',
    'src/**/*.js',
    'we/pcm/**/*.js',
    '!**/node_modules/**',
    '!**/__tests__/**',
    '!**/coverage/**',
    '!**/dist/**',
    '!**/build/**'
  ],

  // The maximum amount of workers used to run your tests
  maxWorkers: '50%',

  // A map from regular expressions to paths to transformers
  transform: {
    '^.+\\.js$': 'babel-jest',
  },

  // An array of file extensions your modules use
  moduleFileExtensions: ['js', 'json'],

  // A list of paths to directories that Jest should use to search for files in
  roots: ['<rootDir>'],

  // The test environment that will be used for testing
  testEnvironment: 'node',

  // The glob patterns Jest uses to detect test files
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[tj]s?(x)',
  ],

  // An array of regexp pattern strings that are matched against all test paths, matched tests are skipped
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/build/',
  ],

  // A map from regular expressions to module names or to arrays of module names that allow to stub out resources with a single module
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // A preset that is used as a base for Jest's configuration
  preset: 'ts-jest',

  // Run tests in band instead of parallel (useful for debugging)
  // runInBand: true,
};