package tests

import (
	"testing"

	"example.com/go-mod-fixture/pkg"
)

func TestHello(t *testing.T) {
	if pkg.Hello() != "hello" {
		t.Fatal("expected hello")
	}
}
