#ifndef INFANTRY_H
#define INFANTRY_H

#include <stdint.h>
#include <stdbool.h>

#pragma pack(push, 1)

typedef struct {
    float re;
    float ddcd;
    uint16_t sdad;
    uint8_t asadadasd;
    double sadada;
    float adsadasda;
    uint8_t adsad;
    uint8_t adsadasda;
    uint8_t asdasdasd;
    float test1;
    double test;
    double testtest;
    double testtesttest;
    double testtesttesttest;
    double testtesttesttesttest;
    double testtesttesttesttesttest;
    double testtesttesttesttesttesttest;
    double testtesttesttesttesttesttesttest;
    double testtesttesttesttesttesttesttesttesttest;
    uint8_t 1111[128]; // Image block data
    int32_t fff;
} infantry_t;

#pragma pack(pop)

// Function declarations
void infantry_init(infantry_t *data);
int infantry_serialize(const infantry_t *data, uint8_t *buffer, size_t buffer_size);
int infantry_deserialize(infantry_t *data, const uint8_t *buffer, size_t buffer_size);

#endif // INFANTRY_H
