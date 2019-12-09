using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using System.Collections.Generic;
using UnityEngine;

public class RegisterAsTarget : MonoBehaviour, ITarget
{
    [Tooltip("True of turrets and missiles should try to kill this if it's an enemy.")]
    public bool Shooting = true;
    public bool AtackTarget => Shooting;

    [Tooltip("True if ships should manuvre towards or away from this (or go round and round it if they want to).")]
    public bool Navigation = false;
    public bool NavigationalTarget => Navigation;

    public Transform Transform => this == null ? null : transform;

    public Rigidbody Rigidbody { get; private set; }

    private TypeKnower typeKnower;

    public ShipType Type => typeKnower.Type;

    public string Team { get; set; }
    
    // Use this for initialization
    void Start () {
        Rigidbody = GetComponent<Rigidbody>();
        typeKnower = GetComponent<TypeKnower>();
        if(typeKnower == null)
        {
            Debug.LogWarning($"{Transform} has no type knower - assuming it's a frigate");
            typeKnower = gameObject.AddComponent<TypeKnower>();
            typeKnower.Type = ShipType.Frigate;
        }
        if (string.IsNullOrEmpty(Team))
        {
            Team = Transform.tag;
        }

        TargetRepository.RegisterTarget(this);
	}

    public void Deactivate()
    {
        TargetRepository.DeregisterTarget(this);
    }
}
