# HardSystem

Plataforma de soporte y comercio ejecutada con software open source en Docker.

## Servicios internos

- Aplicación: `http://192.168.100.68:8080`
- Helpdesk: `http://192.168.100.68:8080/portal.html`
- PostgreSQL, SMTP y Mailpit no publican puertos en la LAN.

La dirección HTTP actual es exclusivamente interna. La publicación en Internet queda bloqueada hasta configurar un nombre público, certificado TLS válido, redirección HTTP a HTTPS y HSTS.

Mailpit es un servicio de desarrollo optativo. Se inicia enlazado a localhost con:

```bash
docker compose --profile development up -d mailpit
```

Para consultarlo de forma remota, use un túnel SSH hacia `127.0.0.1:8025`; no cambie el enlace a `0.0.0.0`.

## Operación

En `/opt/hardsystem`:

```bash
docker compose ps
docker compose logs -f api
docker compose up -d --build --wait --remove-orphans
```

El bootstrap inicial se ejecuta solo de forma puntual, pasando la contraseña temporal sin conservarla en el contenedor:

```bash
docker compose run --rm -e BOOTSTRAP_PASSWORD='contraseña-temporal' api npm run bootstrap
```

Los datos, adjuntos y backups usan volúmenes persistentes. El servicio `backup` genera un `pg_dump` diario, valida su catálogo antes de publicarlo y conserva 14 días. Un dump fallido nunca reemplaza un respaldo válido.

## PayPal

El checkout usa PayPal Orders v2. Como PayPal no admite COP, el carrito conserva sus valores fiscales en COP y cobra en USD con la tasa configurada en `PAYPAL_COP_PER_USD`; la orden registra ambos importes y la tasa utilizada.

Variables requeridas en `.env`:

```dotenv
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=client-id-de-la-aplicacion
PAYPAL_CLIENT_SECRET=client-secret-de-la-aplicacion
PAYPAL_COP_PER_USD=4000
```

Después de modificar estas variables, se debe recrear `api` para aplicar la configuración. Use `sandbox` durante las pruebas y cambie a `live` únicamente con credenciales de producción y una tasa comercial aprobada.

## Roles y acceso

| Rol | Tickets visibles | Operación permitida |
| --- | --- | --- |
| Cliente | Solo incidencias donde es el solicitante | Crear, consultar y comentar sus incidencias |
| Técnico | Solo incidencias asignadas a su usuario | Operar activos, contactos y órdenes de su empresa; actualizar sus incidencias |
| Supervisor | Todas las incidencias | Operar y asignar técnicos |
| Administrador | Todas las incidencias | Operación completa, usuarios, empresas y roles |

El alcance se valida en la API para listados, comentarios, eventos, adjuntos y actualizaciones directas por identificador. La interfaz no se considera una barrera de autorización.

## Recuperación

Para comprobar el estado y listar backups:

```bash
docker compose ps backup
docker compose exec backup ls -lh /backups
```

Cada versión candidata debe restaurar el último dump en un contenedor aislado, sin puertos y con almacenamiento temporal:

```bash
docker run --rm --user postgres \
	--tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=256m,uid=70,gid=70 \
	-v hardsystem_backups_data:/backups:ro \
	-v "$PWD/infra/verify-backup-restore.sh:/verify-backup-restore.sh:ro" \
	-e PGDATA=/var/lib/postgresql/data postgres:17-alpine \
	sh /verify-backup-restore.sh /backups/ARCHIVO.dump
```

Nunca pruebe restauraciones sobre la base activa. Para una recuperación real, detenga primero la API, conserve una copia del volumen actual y restaure únicamente un dump verificado.

## Puerta de seguridad

No se aprueba una publicación si falla cualquiera de estos controles:

- `npm audit` sin vulnerabilidades conocidas y pruebas/compilación de API aprobadas.
- `docker compose config --quiet`, compilación de imágenes y escaneo con Trivy, Docker Scout o equivalente.
- Solo los puertos aprobados escuchan externamente; Mailpit, PostgreSQL y SMTP permanecen internos.
- SSH usa llaves, `PasswordAuthentication no`, `KbdInteractiveAuthentication no` y `PermitRootLogin no`; existe un usuario no-root con `sudo` probado.
- El backup más reciente es no vacío, pasa `pg_restore --list` y restaura en el entorno aislado anterior.
- `docker compose restart` conserva datos y todos los servicios requeridos vuelven a estado `healthy`.
- La política CSP y los encabezados de seguridad están presentes, y catálogo, portal, carrito y checkout PayPal pasan una prueba de navegador.
- Antes de Internet: HTTPS válido, redirección desde HTTP y HSTS son obligatorios. El HTTP interno actual no satisface este control.

Para rollback, conserve la imagen/versión anterior y un dump verificado previo al cambio. Restaure primero los archivos de la versión anterior; revierta datos solo cuando el cambio incluya una migración incompatible y siempre sobre una copia preservada.