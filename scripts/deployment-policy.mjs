console.error(`La web de producción se publica únicamente en Vercel desde la rama main:
https://gestion-almacen-arles-sas.vercel.app/

Este comando NO publica nada. Primero ejecuta npm run verify:web, revisa los
archivos incluidos y solicita autorización para publicar el commit verificado.
Las reglas Firestore se publican por separado con autorización y pruebas.
Consulta DEPLOYMENT.md. Firebase Hosting no es el destino vigente.`);
process.exitCode = 1;
