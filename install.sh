#!/usr/bin/env sh
set -eu

SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR=${AIDE_INSTALL_DIR:-"$HOME/.local/share/aide"}
BIN_DIR=${AIDE_BIN_DIR:-"$HOME/.local/bin"}

if [ ! -x "$SOURCE/runtime/node/bin/node" ]; then
  command -v node >/dev/null 2>&1 || { echo "Node.js 22+ is required. Use the Full package to bundle Node." >&2; exit 1; }
fi
command -v git >/dev/null 2>&1 || { echo "Git is required." >&2; exit 1; }

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$BIN_DIR"
cp -R "$SOURCE"/. "$INSTALL_DIR"/
cat > "$BIN_DIR/aide" <<EOF
#!/usr/bin/env sh
NODE="$INSTALL_DIR/runtime/node/bin/node"
[ -x "\$NODE" ] || NODE=node
exec "\$NODE" "$INSTALL_DIR/bin/aide.mjs" "\$@"
EOF
chmod +x "$BIN_DIR/aide" "$INSTALL_DIR/aide" "$INSTALL_DIR/install.sh" "$INSTALL_DIR/bin/aide.mjs"

echo "AIDE installed to $INSTALL_DIR"
echo "Launcher: $BIN_DIR/aide"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add $BIN_DIR to PATH if 'aide' is not found in a new terminal." ;;
esac
