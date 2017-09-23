using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class SphereExplosion : MonoBehaviour {
    [Tooltip("Amount the collider's radius is increased each fixedUpdate")]
    public float ExpandRate;

    [Tooltip("Frames for which the collision trigger will cause damage to collited objects.")]
    public float Lifetime = 100;

    public Light Light;

    private SphereCollider _collider;

    void Start()
    {
        _collider = gameObject.AddComponent<SphereCollider>();
        _collider.radius = 0;

        //Light.intensity;
    }
	
	void FixedUpdate () {
        if (_collider != null)
        {
            _collider.radius += ExpandRate;
            if (Lifetime <= 0)
            {
                Destroy(_collider);
            }
        }
        if(Lifetime < -100)
        {
            Destroy(gameObject);
        }
        Lifetime--;
    }

    private void OnCollisionEnter(Collision collision)
    {

        //Debug.Log(collision.rigidbody);
    }
}
