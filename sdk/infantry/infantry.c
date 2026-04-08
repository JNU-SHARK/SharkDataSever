#include "infantry.h"
#include <string.h>

void infantry_init(infantry_t *data) {
    memset(data, 0, sizeof(infantry_t));
}

int infantry_serialize(const infantry_t *data, uint8_t *buffer, size_t buffer_size) {
    if (buffer_size < sizeof(infantry_t)) return -1;
    memcpy(buffer, data, sizeof(infantry_t));
    return sizeof(infantry_t);
}

int infantry_deserialize(infantry_t *data, const uint8_t *buffer, size_t buffer_size) {
    if (buffer_size < sizeof(infantry_t)) return -1;
    memcpy(data, buffer, sizeof(infantry_t));
    return sizeof(infantry_t);
}
