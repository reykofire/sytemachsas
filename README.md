# Systemach

Copia funcional completa de HardSystem, preparada como base para la identidad de Systemach.

- Instancia: http://192.168.100.141:8081
- Portal: http://192.168.100.141:8081/portal.html
- Carpeta en Ubuntu: `/opt/systemach`.
- Proyecto Docker Compose: `systemach`.
- HardSystem permanece en el puerto 8080, con sus propios contenedores y vol?menes.

La copia conserva la interfaz original, todas las funciones, usuarios, contrase?as de aplicaci?n, datos, adjuntos e integraciones. Los cambios visuales de Systemach se realizan a partir de esta base. Los ajustes iniciales son el nombre del proyecto, las etiquetas de las im?genes, el puerto HTTP 8081, el puerto opcional de Mailpit 8026 y la URL del portal.

## Qu? contiene la copia

El repositorio contiene el c?digo, recursos visuales, Dockerfiles y Compose. La release `snapshot-20260907` contiene adem?s un respaldo completo cifrado: todos los archivos originales (incluidos `.env`, dependencias instaladas y archivos compilados), las im?genes Docker exactas, los seis vol?menes de la aplicaci?n, una copia f?sica consistente de PostgreSQL y un dump l?gico validado. Los datos y credenciales no se publican en texto claro porque este repositorio es p?blico.

La clave de recuperaci?n se conserva por separado; no est? en GitHub. Sin ella no se puede descifrar el respaldo. La copia incluye las credenciales e integraciones originales de correo y pagos; se conservan para mantener la funcionalidad solicitada. La clave de recuperaci?n y la contrase?a SSH de root son distintas.

## Operaci?n de la instancia existente

```bash
cd /opt/systemach
docker compose ps
docker compose logs --tail 50 api
docker compose up -d --no-build --wait
```

La API y PostgreSQL tienen comprobaciones de salud. El servicio de respaldos genera un dump diario y conserva 14 d?as. Mailpit mantiene su perfil opcional `development`, como en el original.

## Recuperaci?n exacta en un servidor nuevo

Descarga los dos archivos de la [release del respaldo](https://github.com/reykofire/sytemachsas/releases/tag/snapshot-20260907): el archivo `.tar.gpg` y su `.sha256`. Copia la clave de recuperaci?n al servidor por un canal privado. Se requieren Docker con Compose, Python 3, GnuPG y tar.

Ejecuta como root desde la carpeta de descargas:

```bash
sha256sum -c systemach-migration-20260907T202832Z.tar.gpg.sha256
mkdir -m 700 snapshot
gpg --batch --pinentry-mode loopback --passphrase-file /root/systemach-migration-20260907T202832Z.key --output snapshot.tar --decrypt systemach-migration-20260907T202832Z.tar.gpg
tar -xf snapshot.tar -C snapshot
python3 infra/restore-snapshot.py snapshot/systemach-migration-20260907T202832Z --portal-url http://192.168.100.141:8081/portal.html --verify-only
python3 infra/restore-snapshot.py snapshot/systemach-migration-20260907T202832Z --portal-url http://192.168.100.141:8081/portal.html
```

Ejecuta los comandos de descifrado y extracci?n por separado y contin?a solo si cada uno termina correctamente. `snapshot.tar` y la carpeta extra?da contienen informaci?n privada; mantenlos en una carpeta accesible ?nicamente por root. Usa la IP o dominio del servidor de destino en `--portal-url`.

El restaurador verifica las huellas de los archivos, importa las im?genes originales y restaura los vol?menes antes de iniciar servicios. Se detiene si ya existen la carpeta, los contenedores, las redes o los vol?menes del proyecto. No lo ejecutes sobre la instancia que ya funciona. Para otra copia utiliza `--project`, `--destination`, `--port` y `--portal-url` propios.

Un `git clone` por s? solo permite obtener el c?digo, pero la recuperaci?n exacta de usuarios, datos y configuraci?n requiere el respaldo y su clave. No ejecutes el bootstrap sobre una restauraci?n: los usuarios ya est?n incluidos.

## Desarrollo de marca

Los recursos web est?n en `*.html`, `css/`, `js/`, `Logo/` y `slide/`. Los correos y reportes tambi?n incluyen marca en `api/src/`. El primer despliegue reutiliza las im?genes exactas para conservar la funcionalidad; despu?s de editar el c?digo, reconstruye ?nicamente el proyecto Systemach:

```bash
cd /opt/systemach
docker compose up -d --build --wait
```

## Verificaci?n inicial

El 7 de septiembre de 2026 se comprob?:

- Igualdad de las 19 tablas y sus 106 registros entre origen y copia.
- Igualdad SHA-256 de los 7 adjuntos.
- Igualdad de los identificadores de imagen de los cuatro contenedores.
- Respuestas id?nticas en inicio, portal, cat?logo, carrito y `/api/health/ready`.
- Ausencia de vol?menes compartidos entre ambos proyectos.
- API, PostgreSQL y respaldos de Systemach saludables, con un nuevo respaldo generado.

Se verific? una copia funcional sin efectuar cobros ni enviar correos de prueba. La documentaci?n heredada est? en `docs/HARDSYSTEM-ORIGINAL.md`; sus direcciones antiguas describen el origen.
