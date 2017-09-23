using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class SphereExplosion : MonoBehaviour {
    public Transform ExplosionSphere;
    public float ExpandRate;
    private Vector3 _expansion;

    public float Lifetime = 4;
    
    void Start () {
        ExplosionSphere.localScale = Vector3.zero;
        _expansion = Vector3.one * ExpandRate;
	}
	
	void FixedUpdate () {
        ExplosionSphere.localScale += _expansion;
        if (Lifetime <= 0)
        {
            Destroy(gameObject);
        }
        Lifetime--;
    }
}
