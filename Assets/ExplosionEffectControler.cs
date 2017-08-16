using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ExplosionEffectControler : MonoBehaviour {
    public float Lifetime = 4;
    public float RandomLifetime = 0;

    private int _age = 0;

    // Use this for initialization
    void Start () {
        Lifetime += Random.value * RandomLifetime;
	}
	
	// Update is called once per frame
	void Update () {
        if(_age > Lifetime)
        {
            Destroy(this.gameObject);
        }
        _age++;
    }
}
