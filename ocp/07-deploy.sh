#!/bin/bash
set -e

# ============================================================
# Despliegue BotServiciosGL en OKD/OpenShift
# Requisitos: docker, oc (logueado al cluster)
# ============================================================

NEXUS_REGISTRY="srv-osnexus01.minfin.gob.gt:8006"
NEXUS_REPO="botserviciosgl-wa"
TAG="latest"
NAMESPACE="botserviciosgl-wa"
LOCAL_IMAGE="chatbot-serviciosgl:botserviciosgl-wa"

# Usuario/pass de Nexus (cámbialos o usa variables de entorno)
NEXUS_USER="${NEXUS_USER:-admin}"
NEXUS_PASS="${NEXUS_PASS:-}"
ORACLE_USER="${ORACLE_USER:-}"
ORACLE_PASSWORD="${ORACLE_PASSWORD:-}"
ORACLE_DSN="${ORACLE_DSN:-}"

echo "== 1/6 Taggeando imagen local =="
docker tag "$LOCAL_IMAGE" "$NEXUS_REGISTRY/$NEXUS_REPO:$TAG"

echo "== 2/6 Push a Nexus =="
docker login "$NEXUS_REGISTRY" -u "$NEXUS_USER" -p "$NEXUS_PASS"
docker push "$NEXUS_REGISTRY/$NEXUS_REPO:$TAG"

echo "== 3/6 Creando namespace y secreto Oracle =="
oc create namespace "$NAMESPACE" 2>/dev/null || true

# Nota: el secret docker-registry 'nexus-registry' se crea manualmente.
# Si no existe, créalo con:
#   oc create secret docker-registry nexus-registry \
#     --docker-server="$NEXUS_REGISTRY" \
#     --docker-username=TU_USUARIO \
#     --docker-password=TU_PASSWORD \
#     --docker-email=TU_EMAIL \
#     -n "$NAMESPACE"

# Credenciales Oracle del AMBIENTE DE QA (172.20.1.233:1521/PDBQA - IP interna)
# ORACLE_DSN debe apuntar a QA por su IP interna, ej: 172.20.1.233:1521/PDBQA
# (la IP 172.18.28.233 es la NAT pública y NO es alcanzable desde la subred de pods)
oc create secret generic oracle-credentials \
    --from-literal=ORACLE_USER="$ORACLE_USER" \
    --from-literal=ORACLE_PASSWORD="$ORACLE_PASSWORD" \
    --from-literal=ORACLE_DSN="$ORACLE_DSN" \
    -n "$NAMESPACE" \
    --dry-run=client -o yaml | oc apply -f - 2>/dev/null || \
oc create secret generic oracle-credentials \
    --from-literal=ORACLE_USER="$ORACLE_USER" \
    --from-literal=ORACLE_PASSWORD="$ORACLE_PASSWORD" \
    --from-literal=ORACLE_DSN="$ORACLE_DSN" \
    -n "$NAMESPACE"

echo "== 4/6 Aplicando configmap, PVCs, Ollama y Bot =="
oc apply -f ocp/00-configmap.yaml -n "$NAMESPACE"
oc apply -f ocp/01-pvc-bot.yaml -n "$NAMESPACE"
oc apply -f ocp/02-pvc-ollama.yaml -n "$NAMESPACE"
oc apply -f ocp/03-deployment-ollama.yaml -n "$NAMESPACE"
oc apply -f ocp/04-service-ollama.yaml -n "$NAMESPACE"
oc apply -f ocp/05-deployment-bot.yaml -n "$NAMESPACE"

echo "== 5/6 SCC anyuid (la imagen corre como root para Chrome/Xvfb) =="
oc adm policy add-scc-to-user anyuid -z default -n "$NAMESPACE" 2>/dev/null || true

echo "== 6/6 Esperando pods =="
oc rollout status deployment/bot-whatsapp -n "$NAMESPACE" --timeout=300s || true
oc rollout status deployment/ollama -n "$NAMESPACE" --timeout=300s || true

echo ""
echo "============================================"
echo " Despliegue completado"
echo "============================================"
echo "Ver pods:        oc get pods -n $NAMESPACE"
echo "Ver logs:        oc logs -f deployment/bot-whatsapp -n $NAMESPACE"
echo "Ver QR:          oc exec -n $NAMESPACE -it \$(oc get pods -n $NAMESPACE -l app=bot-whatsapp -o jsonpath='{.items[0].metadata.name}') -- cat /app/data/qr.png"
echo "Copiar QR local: oc cp $NAMESPACE/\$(oc get pods -n $NAMESPACE -l app=bot-whatsapp -o jsonpath='{.items[0].metadata.name}'):/app/data/qr.png ./qr.png"
echo "============================================"
