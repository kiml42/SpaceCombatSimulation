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
    private float _intensityScaler;

    void Start()
    {
        _collider = gameObject.AddComponent<SphereCollider>();
        _collider.radius = 0;
        _collider.isTrigger = true;

        _intensityScaler = Light.intensity/Lifetime;
    }
	
	void FixedUpdate () {
        if (_collider != null)
        {
            _collider.radius += ExpandRate;
            Light.intensity -= _intensityScaler;
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

    private void OnTriggerEnter(Collider collider)
    {
        if (!collider.isTrigger)
        {
            var rb = collider.attachedRigidbody;
            var hc = rb.GetComponent("HealthControler") as HealthControler;
            if (rb != null)
            {
                Debug.Log(rb.transform);
            }
            if (hc != null)
            {

            }
        }
    }
}
