const fs = require('fs')
const path = require('path')

const packageJson = require('./package.json')
const outputPath = path.resolve(__dirname, 'src', 'package-info.ts')

const content = `
// This file is auto-generated by embed-package-info.js
export const name = '${packageJson.name}';
export const version = '${packageJson.version}';
`

fs.writeFileSync(outputPath, content)
console.log(`Embedded package info into ${outputPath}`)
