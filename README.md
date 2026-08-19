# Gestión de Almacén ARLES — Web

Versión: **0.1.8-web-final**

Esta carpeta es la entrega final de la migración principal de la aplicación Electron a una aplicación web React + TypeScript + Vite conectada a Firebase Authentication y Cloud Firestore.

## Estado de la migración

La aplicación ya no necesita Electron para su ejecución web. Se conservó la lógica existente de inventario y Firestore, y se sustituyó la exportación Excel dependiente de Electron por generación y descarga desde el navegador.

### Componentes principales
- React + TypeScript + Vite
- Firebase Authentication
- Cloud Firestore con caché persistente
- Inventario y movimientos en tiempo real
- Búsqueda y filtros
- Valoración y análisis de inventario
- Exportación `.xlsx` desde navegador
- Firebase Hosting
- Reglas Firestore propuestas y pruebas de reglas
- App Check opcional

## Inicio local

1. Copia `.env.example` como `.env.local`.
2. Completa las variables Firebase de tu proyecto.
3. Instala dependencias:

```bash
npm install
```

4. Ejecuta:

```bash
npm run dev
```

Vite queda configurado para `http://127.0.0.1:5174`.

## Validación antes de publicar

```bash
npm run verify:web
npm run preview
```

Después comprueba manualmente:
- inicio y cierre de sesión;
- persistencia de sesión al recargar;
- lectura del inventario;
- entradas y salidas;
- movimientos e historial;
- búsquedas y filtros;
- módulos Aseo/Herramientas y demás categorías usadas;
- valoración/análisis;
- exportación Excel;
- comportamiento al perder y recuperar conexión.

Para probar reglas Firestore:

```bash
npm run test:rules
```

## Build

```bash
npm run build
```

El resultado se genera en `dist/`.

## Despliegue de la web

```bash
npm run deploy:hosting
```

O build + despliegue:

```bash
npm run deploy:web
```

### Importante sobre reglas Firestore

`deploy:hosting` **no** modifica las reglas de Firestore.

No uses `npm run deploy:all` hasta validar `firestore.rules` contra todos los clientes que comparten la misma base de datos.

## Variables de entorno

No se incluye `.env.local` real. Utiliza `.env.example` o `.env.production.example` como plantilla y conserva los valores reales fuera de repositorios públicos.

## Archivos de cierre

- `FASE8_RESULTADO.md`: alcance y validaciones de la fase final.
- `CHECKLIST_FINAL.md`: lista de aceptación antes de producción.
- `VALIDAR_LOCAL.cmd`: validación guiada en Windows.
