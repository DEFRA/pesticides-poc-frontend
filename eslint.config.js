import neostandard from 'neostandard'

export default neostandard({
  env: ['node', 'vitest'],
  ignores: [...neostandard.resolveIgnoresFromGitignore(), '**/.public/**'],
  noJsx: true,
  noStyle: true
})
