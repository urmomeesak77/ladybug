<?php

declare(strict_types=1);

namespace Tests\Unit\Utils;

use App\Utils\Json;
use Exception;
use PHPUnit\Framework\TestCase;
use stdClass;

final class JsonTest extends TestCase {
    public function test_encodes_values_to_json(): void {
        $this->assertSame('{"a":1}', Json::encode(['a' => 1]));
        $this->assertSame('5', Json::encode(5));
    }

    public function test_decodes_json_to_objects_and_arrays(): void {
        $this->assertSame(1, Json::decode('{"a":1}')->a);
        $this->assertSame(['a' => 1], Json::decode('{"a":1}', true));
    }

    public function test_exposes_the_last_error_after_a_successful_call(): void {
        Json::encode(['a' => 1]);

        $this->assertSame(JSON_ERROR_NONE, Json::getLastErrorCode());
        $this->assertSame('No error', Json::getLastError());
    }

    public function test_repairs_invalid_utf8_when_encoding(): void {
        $result = Json::encode(['scalar' => 7, 'bad' => "\xB1"]);

        $this->assertJson($result);
        $this->assertSame(7, Json::decode($result)->scalar);
    }

    public function test_repairs_invalid_utf8_inside_an_object_when_encoding(): void {
        $object = new stdClass();
        $object->bad = "\xB1";

        $this->assertJson(Json::encode($object));
    }

    public function test_throws_when_invalid_utf8_cannot_be_repaired(): void {
        $this->expectException(Exception::class);

        Json::encode(['bad' => "\xB1"], 0, 512, false);
    }

    public function test_throws_on_unsupported_types(): void {
        $this->expectException(Exception::class);

        Json::encode(fopen('php://memory', 'r'));
    }

    public function test_repairs_invalid_utf8_when_decoding(): void {
        $this->assertSame("\u{00B1}", Json::decode("\"\xB1\""));
    }

    public function test_throws_on_malformed_json_when_decoding(): void {
        $this->expectException(Exception::class);

        Json::decode('{not valid');
    }
}
