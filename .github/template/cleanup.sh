#!/bin/bash
rm -f .github/workflows/template.yml
rm -f .github/workflows/validate-template.yml
rm -rf .github/template/
mv .github/dependabot.yml .github/example.dependabot.yml
