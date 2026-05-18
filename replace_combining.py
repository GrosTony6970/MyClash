import sys

# Read the file
with open('apps/web-admin/app/admin/leagues/league-utils.ts', 'rb') as f:
    data = f.read()

# The pattern to find (in UTF-8): /[̀-ͯ]/
# ̀ = U+0300 = CC 80 (UTF-8)
# ͯ = U+036F = CD AF (UTF-8)
old_pattern = b'/[\xcc\x80-\xcd\xaf]/'
# Replace with the literal text /[̀-ͯ]/
new_pattern = b'/[\u0300-\u036f]/'

# Replace all occurrences
new_data = data.replace(old_pattern, new_pattern)

# Count replacements
count = (len(data) - len(new_data.replace(new_pattern, b''))) // len(old_pattern) if old_pattern in data else 0
count = data.count(old_pattern)

print(f"Found {count} occurrences of the combining character pattern")

# Write the file
with open('apps/web-admin/app/admin/leagues/league-utils.ts', 'wb') as f:
    f.write(new_data)

print("File updated successfully")
