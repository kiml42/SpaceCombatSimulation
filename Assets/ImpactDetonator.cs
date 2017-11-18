using Assets.Src.Health;
using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ImpactDetonator : MonoBehaviour {
    public Rigidbody DeathExplosion;

    private IDestroyer _destroyer;

    public Rigidbody Shrapnel;
    public int ShrapnelCount2 = 30;
    public float ShrapnelSpeed2 = 20;

    private Rigidbody _rigidbody;

    // Use this for initialization
    void Start()
    {
        _rigidbody = GetComponent<Rigidbody>();

        var exploder = new ShrapnelExploder(_rigidbody, Shrapnel, DeathExplosion, ShrapnelCount2)
        {
            ShrapnelSpeed = ShrapnelSpeed2
        };

        _destroyer = new WithChildrenDestroyer()
        {
            Exploder = exploder,
            UntagChildren = false
        };

        //if (_destroyer == null)
        //{
        //    Debug.LogWarning(gameObject + " has null destroyer");
        //    Start();
        //}
    }

    void OnCollisionEnter(Collision collision)
    {
        //use apply damage to destroy it.
        ApplyDamage();
    }

    /// <summary>
    /// Destroys the projectile
    /// </summary>
    /// <param name="damage"></param>
    public void ApplyDamage(float damage = 0)
    {
        //anything trying to apply damage should destroy this.
        if (_destroyer == null)
        {
            Debug.LogWarning(gameObject + " has null destroyer");
            Start();
        }
        _destroyer.Destroy(gameObject, true);
    }

    /// <summary>
    /// Destroys the projectile
    /// </summary>
    /// <param name="damage"></param>
    public void ApplyDamage(DamagePacket damage)
    {
        ApplyDamage();
    }
}
