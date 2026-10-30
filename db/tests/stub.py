"""Sustituye lo espacial de PostGIS por texto para poder probar el resto del esquema en un PostgreSQL sin PostGIS.
Uso: python3 tests/stub.py <directorio de salida>   (desde la carpeta db/)
Las líneas espaciales llevan la marca [GIS] en las migraciones. La parte espacial se verifica con la imagen de PostGIS."""
import re, sys, glob, os
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for f in sorted(glob.glob('migrations/0*.sql')):
    s = open(f, encoding='utf-8').read()
    s = re.sub(r'CREATE EXTENSION IF NOT EXISTS postgis;\n', '', s)
    s = re.sub(r"  geog .*?\n\s+GENERATED ALWAYS AS \(ST_Force2D\(geom\)::geography\) STORED,\n", '', s, flags=re.S)
    s = '\n'.join(l for l in s.split('\n') if not (l.startswith('CREATE INDEX') and '[GIS]' in l))
    s = re.sub(r'geometry\([A-Za-z]+, ?4326\)', 'text', s)
    open(os.path.join(out, os.path.basename(f)), 'w', encoding='utf-8').write(s)
