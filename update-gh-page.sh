set -e
CurrentBranch=$(git rev-parse --abbrev-ref HEAD)

if [[ $CurrentBranch != "main" ]]; then
  echo "Not on main"
  exit 1
fi

git checkout gh-pages
git merge main

yarn install
rm -rf dist
yarn build-example

rm -rf docs
mkdir docs
cp dist/*.{js,css,html} ./docs/
mv ./docs/flamegraph.html ./docs/index.html
git add docs/*.{js,css,html}
touch docs/.nojekyll
git commit -m 'Update gh-pages'
git push

git checkout $CurrentBranch
