﻿using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class DestroyAfterTimeout : MonoBehaviour {
    public float Lifetime = 4;
    public float RandomLifetime = 0;

    private float _age = 0;

    // Use this for initialization
    void Start () {
        Lifetime += Random.value * RandomLifetime;
	}
	
	// Update is called once per frame
	void FixedUpdate () {
        if(_age > Lifetime)
        {
            Destroy(gameObject);
        }
        _age+=Time.fixedDeltaTime;
    }
}
