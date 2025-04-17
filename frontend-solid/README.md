```
npm install -g mkcert
mkdir ./.cert
cd ./.cert
mkcert create-ca
mkcert create-cert
cd ..
```
```
npm i
npm run dev
```