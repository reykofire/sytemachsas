# Acceso por DDNS y rutas de proyecto

Configuración activa en Ubuntu `192.168.100.141` desde el 7 de septiembre de 2026.

| Proyecto | Dirección principal | Portal | Acceso anterior conservado |
| --- | --- | --- | --- |
| HardSystem | https://ziii.ddns.net/proyectos/hardsystem/ | https://ziii.ddns.net/proyectos/hardsystem/portal.html | http://ziii.ddns.net:15060/portal.html |
| Systemach | https://ziii.ddns.net/proyectos/systemach/ | https://ziii.ddns.net/proyectos/systemach/portal.html | http://ziii.ddns.net:15061/portal.html |

## Recorrido de las conexiones

| Puerto público del router | Destino LAN de Nginx | Destino de la aplicación |
| --- | --- | --- |
| TCP 80 | 192.168.100.141:80 | Validación ACME y redirección a HTTPS |
| TCP 443 | 192.168.100.141:443 | Según `/proyectos/hardsystem/` o `/proyectos/systemach/` |
| TCP 15060 | 192.168.100.141:8080 | HardSystem en 127.0.0.1:18080 |
| TCP 15061 | 192.168.100.141:8081 | Systemach en 127.0.0.1:18081 |

Nginx se ejecuta en el host. Los contenedores web solo publican sus puertos de backend en loopback. Los accesos LAN anteriores `:8080` y `:8081` siguen disponibles, atendidos por Nginx. Las rutas de proyecto también funcionan a través de esos puertos.

## Archivos y configuración

- `infra/nginx-projects.locations.conf` → `/etc/nginx/snippets/projects.locations.conf`.
- `infra/nginx-projects-https.conf` → `/etc/nginx/sites-available/projects`, enlazado desde `sites-enabled`.
- `infra/nginx-projects-ports.conf` → `/etc/nginx/sites-available/projects-ports`, enlazado desde `sites-enabled`.
- `infra/nginx-projects-http.conf` es únicamente el archivo de preparación anterior a la emisión del certificado; no es la configuración final.
- Certificado: `/etc/letsencrypt/live/ziii.ddns.net/`.
- Renovación: `certbot.timer`, con recarga validada de Nginx en `/etc/letsencrypt/renewal-hooks/deploy/20-nginx-reload`.
- Copia previa de los archivos modificados: `/root/projects-routing-20260907/`.

Variables del `.env` privado de HardSystem:

```dotenv
HTTP_BIND=127.0.0.1
HTTP_PORT=18080
PORTAL_URL=https://ziii.ddns.net/proyectos/hardsystem/portal.html
```

Variables del `.env` privado de Systemach:

```dotenv
HTTP_BIND=127.0.0.1
HTTP_PORT=18081
PORTAL_URL=https://ziii.ddns.net/proyectos/systemach/portal.html
```

Las contraseñas de usuario y bases de datos permanecen. La firma JWT de Systemach es independiente de HardSystem. Las sesiones, carritos y retornos del checkout usan claves por ruta; un cambio de origen o ruta requiere iniciar sesión en ese acceso.

Los enlaces HTTP anteriores se mantienen por solicitud del propietario. No se habilita HSTS global en este hostname porque los navegadores convertirían también esos puertos HTTP en HTTPS. Las rutas principales sí utilizan certificado válido y el puerto 80 redirige a HTTPS.

## Despliegues posteriores

Conserva los `.env` privados y las reglas NAT del router. Para actualizar Systemach:

```bash
cd /opt/systemach
git pull --ff-only
docker compose config --quiet
docker compose build web api
docker compose up -d --no-deps --no-build --wait web api
```

Si cambian los archivos de Nginx, cópialos a las ubicaciones indicadas y ejecuta `nginx -t` antes de `systemctl reload nginx`.

La adaptación equivalente de HardSystem está aplicada en `/opt/hardsystem`. Si se restaura su código desde una versión anterior, el helper del repositorio vuelve a adaptar las rutas sin cambiar la marca:

```bash
python3 /opt/systemach/infra/enable-project-paths.py /opt/hardsystem /opt/systemach/js/runtime.js
```

El Compose de HardSystem debe publicar `${HTTP_BIND:-0.0.0.0}:${HTTP_PORT:-8080}:8080`; después reconstruye su web conservando el `.env` del proxy.

## Verificación

Se probaron HTTPS con validación del certificado, páginas y recursos de ambos proyectos, catálogo e imágenes, salud de las API, redirecciones, conservación de los puertos públicos y rechazo de tokens entre proyectos. La prueba de rutas en `api/test/project-paths.test.ts` comprueba además el acceso LAN directo y la separación de claves de almacenamiento.
